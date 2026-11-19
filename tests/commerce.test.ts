import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommerceError } from '../src/server/commerce.js';
import { createCommerce } from '../src/server/node-commerce.js';
import type { Cart, CheckoutQuote, Order, Profile, Product, ReturnRequest } from '../src/shared/commerce.js';
const address = { name: 'Test Shopper', line1: '1 Studio Lane', city: 'Lagos', region: 'Lagos', postalCode: '100001', country: 'Nigeria' };
function fixture() {
  const store = createCommerce(':memory:'); store.ensureCustomer('alice','alice@example.test','Alice'); store.ensureCustomer('bob','bob@example.test','Bob');
  const call = <T>(name: string, input: Record<string,unknown> = {}, who = 'alice') => store.execute(name,input,who) as T;
  const add = (id='daily-mug',quantity=1) => call<Cart>('manage_cart',{operation:'add',items:[{productId:id,quantity}]});
  const quote = () => call<CheckoutQuote>('prepare_checkout',{shippingAddress:address});
  const purchase = (key='order-key') => { const q=quote(); return call<{order:Order;balance:number}>('place_order',{quoteId:q.quoteId,idempotencyKey:key}); };
  return {...store,call,add,quote,purchase};
}
const fails = (fn:()=>unknown,code:string) => assert.throws(fn,(error:unknown)=>error instanceof CommerceError&&error.code===code);

test('prices, offers, coupons, shipping and stock are derived server-side',t=>{
 const f=fixture();t.after(f.close);const cart=f.add();assert.equal(cart.total,2200+895);
 const discounted=f.call<Cart>('manage_cart',{operation:'apply_coupon',coupon:'forme10'});assert.equal(discounted.discount,220);assert.equal(discounted.total,2875);
 const policy=f.call<{payments:{currentOffers:{code:string}[]}}>('get_store_policy');assert.equal(policy.payments.currentOffers[0].code,'FORME10');
 fails(()=>f.call('manage_cart',{operation:'add',items:[{productId:'needle-turntable',quantity:1}]}),'insufficient_stock');
 fails(()=>f.call('manage_cart',{operation:'add',items:[{productId:'daily-mug',quantity:-1}]}),'invalid_input');
 fails(()=>f.call('manage_cart',{operation:'add',items:[{productId:'daily-mug',quantity:1.5}]}),'invalid_input');
 assert.equal(f.call<Cart>('manage_cart',{operation:'view'}).itemCount,1);
});
test('changed, consumed, expired and foreign checkout quotes cannot commit',t=>{
 const f=fixture();t.after(f.close);f.add();const q=f.quote();f.add('line-pen');fails(()=>f.call('place_order',{quoteId:q.quoteId,idempotencyKey:'stale'}),'cart_changed');
 const current=f.quote();fails(()=>f.call('place_order',{quoteId:current.quoteId,idempotencyKey:'foreign'},'bob'),'not_found');
 f.db.prepare('UPDATE checkout_quotes SET expires_at = 0 WHERE id = ?').run(current.quoteId);fails(()=>f.call('place_order',{quoteId:current.quoteId,idempotencyKey:'expired'}),'quote_expired');
 const next=f.quote();const result=f.call<{order:Order}>('place_order',{quoteId:next.quoteId,idempotencyKey:'once'});
 fails(()=>f.call('place_order',{quoteId:next.quoteId,idempotencyKey:'twice'}),'quote_consumed');
 assert.equal(f.call<{order:Order}>('place_order',{quoteId:next.quoteId,idempotencyKey:'once'}).order.id,result.order.id);
 fails(()=>f.call('place_order',{quoteId:'different-quote',idempotencyKey:'once'}),'idempotency_conflict');
});
test('competing stock reservations cannot oversell and failed checkout rolls back',t=>{
 const f=fixture();t.after(f.close);f.db.prepare("UPDATE inventory SET stock=1 WHERE product_id='daily-mug'").run();f.add();const alice=f.quote();f.call('manage_cart',{operation:'add',items:[{productId:'daily-mug',quantity:1}]},'bob');const bob=f.call<CheckoutQuote>('prepare_checkout',{shippingAddress:address},'bob');
 f.call('place_order',{quoteId:alice.quoteId,idempotencyKey:'alice'});fails(()=>f.call('place_order',{quoteId:bob.quoteId,idempotencyKey:'bob'},'bob'),'insufficient_stock');assert.equal(f.call<Profile>('get_account',{},'bob').balance,250000);assert.equal(f.call<Cart>('manage_cart',{operation:'view'},'bob').itemCount,1);
});
test('balance rejection never debits inventory',t=>{
 const f=fixture();t.after(f.close);f.add();f.db.prepare("UPDATE customers SET balance=1 WHERE id='alice'").run();const q=f.quote();assert.equal(q.canPlaceOrder,false);fails(()=>f.call('place_order',{quoteId:q.quoteId,idempotencyKey:'poor'}),'insufficient_balance');assert.equal(f.db.prepare("SELECT stock FROM inventory WHERE product_id='daily-mug'").get()!.stock,45);
});
test('cancellation restores exact credit and stock only once',t=>{
 const f=fixture();t.after(f.close);f.add();const {order}=f.purchase();const result=f.call<{balance:number;order:Order}>('change_order',{orderId:order.id,operation:'cancel'});assert.equal(result.balance,250000);assert.equal(result.order.status,'cancelled');fails(()=>f.call('change_order',{orderId:order.id,operation:'cancel'}),'order_locked');assert.equal(f.db.prepare("SELECT stock FROM inventory WHERE product_id='daily-mug'").get()!.stock,45);
});
test('delivered partial returns refund discounted merchandise once and remain retrievable',t=>{
 const f=fixture();t.after(f.close);const start=Date.now();t.mock.method(Date,'now',()=>start);f.add('daily-mug');f.add('line-pen');f.call('manage_cart',{operation:'apply_coupon',coupon:'FORME10'});const {order}=f.purchase();
 fails(()=>f.call('request_return',{orderId:order.id,reason:'Changed mind'}),'order_not_delivered');t.mock.method(Date,'now',()=>start+31000);
 const partial=f.call<{return:ReturnRequest;order:Order}>('request_return',{orderId:order.id,reason:'Not right for my desk',productIds:['daily-mug']});assert.equal(partial.return.refund,1980);assert.equal(partial.order.status,'partially_returned');fails(()=>f.call('request_return',{orderId:order.id,reason:'Again',productIds:['daily-mug']}),'already_returned');
 const rest=f.call<{return:ReturnRequest;balance:number}>('request_return',{orderId:order.id,reason:'Changed mind'});assert.equal(rest.return.refund,2520);assert.equal(rest.balance,250000-order.shipping);
 const fetched=f.call<{orders:Order[]}>('track_orders',{orderId:order.id});assert.equal(fetched.orders[0].returns?.length,2);assert.equal(fetched.orders[0].returns?.reduce((sum,item)=>sum+item.refund,0),4500);
 fails(()=>f.call('request_return',{orderId:order.id,reason:'Again'}),'already_returned');
});
test('return window and order change cutoff are enforced by current state',t=>{
 const f=fixture();t.after(f.close);const start=Date.now();t.mock.method(Date,'now',()=>start);f.add();const {order}=f.purchase();t.mock.method(Date,'now',()=>start+13000);fails(()=>f.call('change_order',{orderId:order.id,operation:'change_address',shippingAddress:address}),'order_locked');t.mock.method(Date,'now',()=>start+31*86400000);fails(()=>f.call('request_return',{orderId:order.id,reason:'Late'}),'return_window_closed');
});
test('customer data and support references cannot cross account boundaries',t=>{
 const f=fixture();t.after(f.close);f.add();const {order}=f.purchase();for(const action of ['track_orders','reorder','change_order','request_return'])fails(()=>f.call(action,{orderId:order.id,operation:'cancel',reason:'x'},'bob'),'not_found');fails(()=>f.call('contact_support',{orderId:order.id,subject:'x',message:'x'},'bob'),'not_found');
 const profile=f.call<Profile>('update_profile',{address});fails(()=>f.call('update_profile',{removeAddressId:profile.addresses[0].id},'bob'),'not_found');
});
test('reviews require delivered purchases and update one review per customer',t=>{
 const f=fixture();t.after(f.close);const start=Date.now();t.mock.method(Date,'now',()=>start);const review={operation:'submit',productId:'daily-mug',rating:5,title:'Useful',body:'A good everyday mug.'};fails(()=>f.call('manage_review',review),'verified_purchase_required');f.add();f.purchase();t.mock.method(Date,'now',()=>start+31000);f.call('manage_review',review);f.call('manage_review',{...review,rating:4});const list=f.call<{reviews:unknown[];total:number}>('manage_review',{operation:'list',productId:'daily-mug'});assert.equal(list.total,1);assert.equal(list.reviews.length,1);const product=f.call<{products:Product[]}>('inspect_products',{productIds:['daily-mug']}).products[0];assert.equal(product.rating,4);assert.equal(product.reviewCount,1);
});
test('support and order history have bounded pagination',t=>{
 const f=fixture();t.after(f.close);for(let i=0;i<12;i++){f.call('contact_support',{subject:`Case ${i}`,message:'A question'});f.add();f.purchase(`key${i}`);}const first=f.call<{tickets:{id:string}[];hasMore:boolean;total:number}>('list_support_requests',{limit:8});const next=f.call<{tickets:{id:string}[];hasMore:boolean}>('list_support_requests',{limit:8,offset:8});assert.equal(first.total,12);assert.equal(first.hasMore,true);assert.equal(next.tickets.length,4);assert.equal(next.hasMore,false);assert.equal(new Set([...first.tickets,...next.tickets].map(x=>x.id)).size,12);assert.equal(f.call<{orders:Order[]}>('track_orders',{limit:8,offset:8}).orders.length,4);
});
test('saved state survives database restart',()=>{
 const directory=mkdtempSync(join(tmpdir(),'forme-persistence-'));const file=join(directory,'store.sqlite');let f=createCommerce(file);try{f.ensureCustomer('alice','alice@example.test','Alice');f.execute('manage_cart',{operation:'add',items:[{productId:'daily-mug',quantity:2}]},'alice');f.close();f=createCommerce(file);assert.equal((f.execute('manage_cart',{operation:'view'},'alice') as Cart).itemCount,2);}finally{f.close();rmSync(directory,{recursive:true,force:true});}
});
