export type SqlParameter = string | number | null;
export type SqlValue = SqlParameter | bigint | Uint8Array | ArrayBuffer;
export type SqlRow = Record<string, SqlValue>;

export interface SqlStatement {
  get(...parameters: SqlParameter[]): SqlRow | undefined;
  all(...parameters: SqlParameter[]): SqlRow[];
  run(...parameters: SqlParameter[]): { changes: number | bigint };
  iterate(...parameters: SqlParameter[]): Iterable<SqlRow>;
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  transaction<T>(callback: () => T): T;
  close(): void;
}
