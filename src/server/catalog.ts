import type { Category, Product } from "../shared/commerce.js";

export const categories: readonly Category[] = ["Home", "Desk", "Travel", "Audio"];

type CatalogEntry = Omit<Product, "id" | "currency" | "images" | "rating" | "reviewCount">;

const entries: CatalogEntry[] = [
  {
    slug: "arc-task-lamp", name: "Arc Task Lamp", category: "Desk",
    description: "A compact reading lamp with a soft, directional glow. Angle the shade toward a page, a keyboard, or the corner of the room as the day changes.",
    price: 12800, colors: ["Sand", "Ink"], stock: 24, badge: "Bestseller",
    features: ["Pivoting shade", "Weighted base with felt underside", "Inline on/off switch"],
    specs: { Material: "Powder-coated steel", Height: "16 in", Base: "6.3 in diameter", Bulb: "E26 LED up to 8 W" },
  },
  {
    slug: "studio-wireless-headphones", name: "Studio Wireless Headphones", category: "Audio",
    description: "Over-ear headphones for working, walking, and listening straight through an album. The ear cups swivel flat so they take up less room in a bag.",
    price: 16800, compareAtPrice: 19800, colors: ["Stone", "Ink", "Clay"], stock: 19, badge: "Bestseller",
    features: ["Active noise cancellation", "Multipoint Bluetooth", "Replaceable ear cushions", "USB-C charging"],
    specs: { Battery: "Up to 32 hours", Connectivity: "Bluetooth 5.3 and 3.5 mm", Weight: "246 g", Includes: "USB-C cable and soft case" },
  },
  {
    slug: "transit-weekender", name: "Transit Weekender", category: "Travel",
    description: "A structured canvas duffel for two nights away. Its zipper opens wide for packing, with a separate pocket for shoes and a slip for the things you reach for most.",
    price: 11800, colors: ["Olive", "Ink", "Sand"], stock: 21, badge: "New",
    features: ["Wide-opening zipper", "Separate shoe compartment", "Removable shoulder strap", "Luggage handle sleeve"],
    specs: { Capacity: "31 L", Material: "Heavyweight cotton canvas", Dimensions: "19 × 11 × 9 in", Care: "Spot clean" },
  },
  {
    slug: "form-ceramic-set", name: "Form Ceramic Set", category: "Home",
    description: "Six stackable stoneware pieces with a satin glaze. The shallow bowls are deep enough for broth or a generous serving of pasta.",
    price: 8400, colors: ["Oat", "Clay", "Moss"], stock: 30,
    features: ["Service for two", "Stackable shapes", "Satin glaze", "Dishwasher and microwave safe"],
    specs: { Pieces: "Two dinner plates, two side plates, two bowls", Material: "Glazed stoneware", Plate: "10.5 in diameter", Bowl: "22 fl oz" },
  },
  {
    slug: "field-notes-set", name: "Field Notes Set", category: "Desk",
    description: "Three slim notebooks with different ruling for writing, sketching, and planning. Lay them flat for quick notes or slip one into a jacket pocket.",
    price: 2400, colors: ["Sand", "Clay", "Moss"], stock: 40,
    features: ["Ruled, grid, and plain pages", "Flexible paper covers", "Lay-flat stitched binding"],
    specs: { Size: "4 × 6 in", Pages: "48 per notebook", Paper: "90 gsm uncoated", Includes: "Set of three" },
  },
  {
    slug: "ridge-carryall", name: "Ridge Carryall", category: "Travel",
    description: "An upright canvas tote with long handles that sit comfortably over a coat. The lining wipes clean after spills, and a padded sleeve holds your laptop close to your body.",
    price: 6400, colors: ["Sand", "Ink", "Olive"], stock: 26,
    features: ["Padded laptop sleeve", "Reinforced handles", "Internal key clip", "Two exterior slip pockets"],
    specs: { Capacity: "17 L", Material: "Cotton canvas with nylon lining", Fit: "Laptops up to 14 in", Dimensions: "15 × 13 × 5.5 in" },
  },
  {
    slug: "loop-speaker", name: "Loop Speaker", category: "Audio",
    description: "A portable Bluetooth speaker wrapped in soft woven fabric. Its carry loop slips onto a bag strap, and the physical buttons are easy to find by touch.",
    price: 7900, compareAtPrice: 9400, colors: ["Moss", "Sand", "Ink"], stock: 12,
    features: ["Splash-resistant enclosure", "Pair two speakers for stereo", "Tactile controls", "USB-C charging"],
    specs: { Battery: "Up to 12 hours", Connectivity: "Bluetooth 5.3", Resistance: "IPX5", Weight: "385 g" },
  },
  {
    slug: "sunday-throw", name: "Sunday Throw", category: "Home",
    description: "A soft cotton throw with a small waffle weave that traps warmth without much weight. The hem lies flat when folded over an armchair or at the foot of the bed.",
    price: 6800, colors: ["Oat", "Olive", "Clay"], stock: 18,
    features: ["Textured waffle weave", "Prewashed cotton", "Double-turned hem"],
    specs: { Material: "100% cotton", Size: "50 × 60 in", Care: "Machine wash cold" },
  },
  {
    slug: "daily-mug", name: "Daily Mug", category: "Home",
    description: "A low stoneware mug with a generous handle and a smooth rolled lip. Small variations in the speckled glaze are visible under morning light.",
    price: 2200, colors: ["Oat", "Clay", "Moss"], stock: 45,
    features: ["Comfortable three-finger handle", "Speckled satin glaze", "Dishwasher and microwave safe"],
    specs: { Capacity: "11 fl oz", Material: "Glazed stoneware", Height: "3.5 in" },
  },
  {
    slug: "column-vase", name: "Column Vase", category: "Home",
    description: "Fine vertical ribs give this ceramic vase a different appearance as the light moves. Its narrow opening keeps a few stems upright.",
    price: 4200, colors: ["Sand", "Clay"], stock: 11,
    features: ["Ribbed ceramic exterior", "Watertight glazed interior", "Narrow mouth for small arrangements"],
    specs: { Height: "8.5 in", Diameter: "3.9 in", Material: "Glazed ceramic", Care: "Hand wash" },
  },
  {
    slug: "fold-basket", name: "Fold Basket", category: "Home",
    description: "Woven cotton rope gives this round basket enough structure to stand on its own. Use it for a spare blanket, a stack of magazines, or laundry in a narrow room.",
    price: 5400, colors: ["Sand", "Oat"], stock: 10,
    features: ["Soft sides", "Two woven handles", "Folds flat for storage"],
    specs: { Material: "Coiled cotton rope", Dimensions: "14 × 12 in", Care: "Spot clean" },
  },
  {
    slug: "still-candle", name: "Still Candle", category: "Home",
    description: "Cedar and bergamot give this candle a fresh, dry scent. Its amber glass makes a small pool of warm light and can be reused once the wax is gone.",
    price: 3200, colors: ["Amber"], stock: 22,
    features: ["Cedar and bergamot", "Cotton wick", "Reusable amber glass"],
    specs: { Wax: "Soy blend", Size: "8 oz", Burn: "Up to 45 hours" },
  },
  {
    slug: "plane-desk-mat", name: "Plane Desk Mat", category: "Desk",
    description: "A soft felt surface for a keyboard and mouse. The natural cork backing grips the desk, while felt takes the chill off a metal desktop.",
    price: 4400, colors: ["Sand", "Ink", "Moss"], stock: 27,
    features: ["Dense felt surface", "Cork grip backing", "Rounded corners"],
    specs: { Dimensions: "27.5 × 12 in", Thickness: "3 mm", Material: "Felt and natural cork", Care: "Brush gently or spot clean" },
  },
  {
    slug: "line-pen", name: "Line Pen", category: "Desk",
    description: "A retractable ballpoint with a brushed aluminum barrel. Its balance sits low in the hand, and the refill is a widely available standard shape.",
    price: 2800, colors: ["Charcoal", "Silver"], stock: 34,
    features: ["Click mechanism", "Replaceable ink cartridge", "Spring-steel pocket clip"],
    specs: { Length: "5.4 in", Material: "Anodized aluminum", Tip: "0.7 mm", Refill: "Parker-style G2 ballpoint" },
  },
  {
    slug: "lift-laptop-stand", name: "Lift Laptop Stand", category: "Desk",
    description: "A folding aluminum stand that brings a laptop screen closer to eye level. Its open frame leaves space for airflow and folds flat when the workday is over.",
    price: 5800, colors: ["Silver", "Ink"], stock: 16,
    features: ["Seven angle settings", "Nonslip silicone pads", "Folds flat for travel"],
    specs: { Material: "Anodized aluminum", Fit: "11–16 in laptops", Weight: "310 g", Load: "Up to 6.6 lb" },
  },
  {
    slug: "roam-bottle", name: "Roam Bottle", category: "Travel",
    description: "A double-wall steel bottle with a narrow profile and a generous opening for ice. The powder-coated finish is easy to grip with wet hands.",
    price: 3800, colors: ["Sand", "Olive", "Ink"], stock: 32,
    features: ["Vacuum insulated", "Leak-resistant screw lid", "Fits most car cup holders"],
    specs: { Capacity: "20 fl oz", Material: "18/8 stainless steel", Diameter: "2.8 in", Care: "Hand wash" },
  },
  {
    slug: "passage-packing-cubes", name: "Passage Packing Cubes", category: "Travel",
    description: "Three soft zip organizers keep clean clothes, knits, and layers easy to find. The mesh tops let you see what's inside as soon as you open your bag.",
    price: 3600, colors: ["Olive", "Sand", "Ink"], stock: 28,
    features: ["Three nesting sizes", "Mesh tops", "Two-way zippers", "Grab handles"],
    specs: { Material: "Ripstop nylon", Large: "14 × 10 × 4 in", Medium: "11 × 8 × 4 in", Small: "8 × 6 × 3 in" },
  },
  {
    slug: "pocket-tech-case", name: "Pocket Tech Case", category: "Travel",
    description: "A zip case for the cables and small adapters that tend to sink to the bottom of a bag. It opens flat so everything stays visible.",
    price: 3400, colors: ["Charcoal", "Sand", "Olive"], stock: 25,
    features: ["Flat-opening clamshell", "Elastic cable loops", "Zipped mesh pocket"],
    specs: { Material: "Water-resistant recycled nylon", Dimensions: "7 × 4.5 × 2 in", Weight: "118 g" },
  },
  {
    slug: "aura-earbuds", name: "Aura Earbuds", category: "Audio",
    description: "Lightweight in-ear buds with soft silicone tips for a close fit. The rounded charging case slips into a coin pocket between calls or commutes.",
    price: 9800, colors: ["Oat", "Ink"], stock: 15, badge: "New",
    features: ["Transparency mode", "Two microphones per bud", "Three tip sizes", "Pocket charging case"],
    specs: { Battery: "Up to 7 hours per charge, 26 hours with case", Connectivity: "Bluetooth 5.3", Resistance: "IPX4 earbuds", Charging: "USB-C" },
  },
  {
    slug: "needle-turntable", name: "Needle Turntable", category: "Audio",
    description: "A belt-drive record player on a low oak-veneer plinth. A built-in preamp makes it easy to connect to powered speakers with a line input.",
    price: 24800, colors: ["Oak"], stock: 0,
    features: ["Switchable phono preamp", "Adjustable counterweight", "Replaceable stylus", "Hinged dust cover"],
    specs: { Speeds: "33⅓ and 45 rpm", Drive: "Belt", Output: "Stereo RCA", Dimensions: "16 × 13 × 5 in" },
  },
];

export const catalog: Product[] = entries.map((entry) => ({
  ...entry,
  id: entry.slug,
  currency: "USD",
  images: [`/images/${entry.slug}.webp`],
  rating: 0,
  reviewCount: 0,
}));
