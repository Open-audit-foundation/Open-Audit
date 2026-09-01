import type { IncomingMessage, Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";

export interface EventWebSocketServerOptions {
  httpServer: HttpServer;
  path?: string;
  maxConnectionsPerIp?: number;
  logPrefix?: string;
}

export interface EventWebSocketServer {
  broadcast: (data: unknown) => void;
  getConnectionCount: () => number;
  close: () => Promise<void>;
}

function getClientIp(req: IncomingMessage): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress ?? "unknown";
}

function decrementConnectionCount(connectionsByIp: Map<string, number>, clientIp: string): void {
  const remaining = (connectionsByIp.get(clientIp) ?? 0) - 1;
  if (remaining <= 0) {
    connectionsByIp.delete(clientIp);
  } else {
    connectionsByIp.set(clientIp, remaining);
  }
}

/**
 * Attach a WebSocket server with per-IP connection limiting and broadcast support.
 * Shared by the legacy monolith and the decoupled web server.
 */
export function createEventWebSocketServer(
  options: EventWebSocketServerOptions
): EventWebSocketServer {
  const {
    httpServer,
    path = "/ws/events",
    maxConnectionsPerIp = parseInt(process.env.MAX_WS_CONNECTIONS_PER_IP ?? "5", 10),
    logPrefix = "[WS]",
  } = options;

  const connectionsByIp = new Map<string, number>();
  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on("connection", (socket, request) => {
    const clientIp = request ? getClientIp(request) : "unknown";
    const activeConnections = (connectionsByIp.get(clientIp) ?? 0) + 1;

    if (activeConnections > maxConnectionsPerIp) {
      console.warn(
        `${logPrefix} Rejecting connection from ${clientIp}: too many connections (${activeConnections})`
      );
      socket.close(1008, "Too many connections from this IP");
      return;
    }

    connectionsByIp.set(clientIp, activeConnections);
    console.log(`${logPrefix} Client connected from ${clientIp} (${activeConnections} active)`);

    const releaseConnection = () => {
      decrementConnectionCount(connectionsByIp, clientIp);
      const remaining = connectionsByIp.get(clientIp) ?? 0;
      console.log(`${logPrefix} Client disconnected from ${clientIp} (${Math.max(remaining, 0)} remaining)`);
    };

    socket.on("close", releaseConnection);
    socket.on("error", releaseConnection);
  });

  return {
    broadcast(data: unknown): void {
      const message = JSON.stringify(data);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    },

    getConnectionCount(): number {
      return wss.clients.size;
    },

    async close(): Promise<void> {
      for (const client of wss.clients) {
        client.close();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
