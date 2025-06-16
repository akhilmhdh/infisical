declare module "node-rdpjs" {
  import { EventEmitter } from "events";

  // RDP Client Configuration Interface
  interface RdpClientConfig {
    domain: string;
    userName: string;
    password: string;
    enablePerf?: boolean;
    autoLogin?: boolean;
    screen?: {
      width: number;
      height: number;
    };
    locale?: string;
    logLevel?: string;
  }

  // Bitmap Data Interface
  interface RdpBitmap {
    x: number;
    y: number;
    width: number;
    height: number;
    data: Buffer;
    bitsPerPixel?: number;
  }

  // RDP Client Class
  export class RdpClient extends EventEmitter {
    constructor(config: RdpClientConfig);

    // Connection methods
    connect(host: string, port: number): RdpClient;
    close(): void;

    // Input methods
    sendPointerEvent(x: number, y: number, button: number, isPressed: boolean): void;
    sendWheelEvent(x: number, y: number, step: number, isNegative: boolean, isHorizontal: boolean): void;
    sendKeyEventScancode(code: number, isPressed: boolean): void;
    sendKeyEventUnicode(code: number, isPressed: boolean): void;

    // Event handlers
    on(event: "connect", listener: () => void): this;
    on(event: "bitmap", listener: (bitmap: RdpBitmap) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;

    emit(event: "connect"): boolean;
    emit(event: "bitmap", bitmap: RdpBitmap): boolean;
    emit(event: "close"): boolean;
    emit(event: "error", err: Error): boolean;
    emit(event: string, ...args: unknown[]): boolean;
  }

  // Main RDP Module Interface
  interface RdpModule {
    createClient(config: RdpClientConfig): RdpClient;
  }

  const rdp: RdpModule;
  export = rdp;
}
