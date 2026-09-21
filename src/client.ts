import { sockPath } from "./paths.ts";
import type { RpcRequest, RpcResponse } from "./rpc.ts";

export function canConnect(root: string, timeoutMs = 200): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    Bun.connect({
      unix: sockPath(root),
      socket: {
        data() {
          /* required by bun */
        },
        open(socket) {
          socket.end();
          done(true);
        },
        connectError() {
          done(false);
        },
        error() {
          done(false);
        },
      },
    }).catch(() => done(false));
  });
}

export function rpc(root: string, req: RpcRequest, timeoutMs = 5000): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buf = "";
    const finish = (err: Error | null, res?: RpcResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(res as RpcResponse);
      }
    };
    const timer = setTimeout(() => finish(new Error("wcpd did not reply")), timeoutMs);
    Bun.connect({
      unix: sockPath(root),
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify(req)}\n`);
        },
        data(socket, data) {
          buf += typeof data === "string" ? data : new TextDecoder().decode(data);
          const nl = buf.indexOf("\n");
          if (nl >= 0) {
            try {
              const parsed = JSON.parse(buf.slice(0, nl)) as RpcResponse;
              socket.end();
              finish(null, parsed);
            } catch (e) {
              socket.end();
              finish(e instanceof Error ? e : new Error(String(e)));
            }
          }
        },
        connectError(_socket, error) {
          finish(error);
        },
        error(_socket, error) {
          finish(error);
        },
      },
    }).catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}
