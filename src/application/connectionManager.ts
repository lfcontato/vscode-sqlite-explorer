import { DatabaseService } from './databaseService';

export interface Connection { key: string; path: string; service: DatabaseService }
/** Single owner per connection; factory injection keeps driver construction at the composition root. */
export class ConnectionManager {
  private readonly connections = new Map<string, Promise<Connection>>();
  constructor(private readonly factory: (path: string) => Promise<DatabaseService>) {}
  open(key: string, path: string): Promise<Connection> {
    let pending = this.connections.get(key);
    if (!pending) {
      pending = this.factory(path).then(service => ({ key, path, service }));
      this.connections.set(key, pending);
      void pending.catch(() => { if (this.connections.get(key) === pending) { this.connections.delete(key); } });
    }
    return pending;
  }
  all(): Promise<Connection[]> { return Promise.all([...this.connections.values()]); }
  async close(key: string): Promise<void> {
    const pending = this.connections.get(key);
    this.connections.delete(key);
    if (pending) { await (await pending).service.close(); }
  }
  async dispose(): Promise<void> { await Promise.allSettled([...this.connections.keys()].map(key => this.close(key))); }
}
