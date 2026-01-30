export interface Plugin {
  name: string;
  setup(app: any): Promise<void> | void;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}
