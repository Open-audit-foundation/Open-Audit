/**
 * System Status Dashboard
 *
 * Real-time status monitoring dashboard that displays:
 * - Overall system health
 * - Component status (Stellar RPC, Database, Redis, Worker)
 * - Circuit breaker state
 * - System metrics
 * - Auto-refreshes every 30 seconds
 *
 * Accessible at: /status
 */

"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, Clock, Activity, Database, Server, Zap, RefreshCw } from "lucide-react";

// ============================================================================
// Type Definitions
// ============================================================================

type ComponentStatus = "healthy" | "degraded" | "down" | "not-configured";
type OverallStatus = "healthy" | "degraded" | "down";

interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
  error?: string;
  details?: Record<string, any>;
}

interface StatusData {
  status: OverallStatus;
  timestamp: string;
  version: string;
  environment: string;
  components: {
    stellarRpc: ComponentHealth;
    database: ComponentHealth;
    redis: ComponentHealth;
    worker: ComponentHealth;
  };
  circuitBreaker?: {
    state: string;
    metrics: Record<string, any>;
  };
  metrics?: {
    events: {
      last1Hour: number;
      last24Hours: number;
    };
    translations: {
      successRate: number;
      averageLatencyMs: number;
    };
    websocket: {
      activeConnections: number;
    };
  };
  checks: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    durationMs: number;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function getStatusColor(status: ComponentStatus | OverallStatus): string {
  switch (status) {
    case "healthy":
      return "text-green-600";
    case "degraded":
      return "text-yellow-600";
    case "down":
      return "text-red-600";
    case "not-configured":
      return "text-gray-500";
    default:
      return "text-gray-500";
  }
}

function getStatusBgColor(status: ComponentStatus | OverallStatus): string {
  switch (status) {
    case "healthy":
      return "bg-green-50 border-green-200";
    case "degraded":
      return "bg-yellow-50 border-yellow-200";
    case "down":
      return "bg-red-50 border-red-200";
    case "not-configured":
      return "bg-gray-50 border-gray-200";
    default:
      return "bg-gray-50 border-gray-200";
  }
}

function getStatusIcon(status: ComponentStatus | OverallStatus) {
  switch (status) {
    case "healthy":
      return <CheckCircle className="w-5 h-5" />;
    case "degraded":
      return <AlertCircle className="w-5 h-5" />;
    case "down":
      return <XCircle className="w-5 h-5" />;
    case "not-configured":
      return <AlertCircle className="w-5 h-5" />;
    default:
      return <AlertCircle className="w-5 h-5" />;
  }
}

function formatStatus(status: ComponentStatus | OverallStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ");
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

function getCircuitBreakerColor(state: string): string {
  switch (state) {
    case "CLOSED":
      return "text-green-600";
    case "HALF_OPEN":
      return "text-yellow-600";
    case "OPEN":
      return "text-red-600";
    default:
      return "text-gray-500";
  }
}

// ============================================================================
// Component Status Card
// ============================================================================

interface ComponentCardProps {
  name: string;
  icon: React.ReactNode;
  health: ComponentHealth;
}

function ComponentCard({ name, icon, health }: ComponentCardProps) {
  const { status, latencyMs, error, details } = health;

  return (
    <div className={`p-6 rounded-lg border-2 ${getStatusBgColor(status)}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={getStatusColor(status)}>{icon}</div>
          <h3 className="font-semibold text-gray-900">{name}</h3>
        </div>
        <div className={`flex items-center space-x-2 ${getStatusColor(status)}`}>
          {getStatusIcon(status)}
          <span className="text-sm font-medium">{formatStatus(status)}</span>
        </div>
      </div>

      {latencyMs !== undefined && (
        <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
          <Clock className="w-4 h-4" />
          <span>{latencyMs}ms</span>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 mb-2">
          <strong>Error:</strong> {error}
        </div>
      )}

      {details && Object.keys(details).length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-600 space-y-1">
            {Object.entries(details).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="font-medium">{key}:</span>
                <span className="text-gray-900">
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Status Page
// ============================================================================

export default function StatusPage() {
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    try {
      setRefreshing(true);
      const response = await fetch("/api/status");
      const data = await response.json();
      setStatusData(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to fetch status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    if (autoRefresh) {
      const interval = setInterval(fetchStatus, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading system status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Failed to Load Status</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={fetchStatus}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!statusData) {
    return null;
  }

  const { status, timestamp, version, environment, components, circuitBreaker, metrics, checks } =
    statusData;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className={`${getStatusBgColor(status)} border-b-2`}>
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Open-Audit Status</h1>
              <p className="text-gray-600">
                Real-time system health monitoring and metrics
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-4 py-2 rounded-lg ${
                  autoRefresh ? "bg-blue-600 text-white" : "bg-white text-gray-700"
                } border-2 border-gray-300 hover:border-blue-600`}
              >
                Auto-refresh {autoRefresh ? "ON" : "OFF"}
              </button>
              <button
                onClick={fetchStatus}
                disabled={refreshing}
                className="px-4 py-2 bg-white text-gray-700 rounded-lg border-2 border-gray-300 hover:border-blue-600 disabled:opacity-50"
              >
                <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Overall Status */}
          <div className="flex items-center space-x-4">
            <div className={`flex items-center space-x-2 ${getStatusColor(status)}`}>
              {getStatusIcon(status)}
              <span className="text-2xl font-bold">{formatStatus(status)}</span>
            </div>
            <div className="text-sm text-gray-600">
              <div>Version: {version}</div>
              <div>Environment: {environment}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Components Grid */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Components</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ComponentCard
              name="Stellar RPC"
              icon={<Activity className="w-6 h-6" />}
              health={components.stellarRpc}
            />
            <ComponentCard
              name="Database"
              icon={<Database className="w-6 h-6" />}
              health={components.database}
            />
            <ComponentCard
              name="Redis Cache"
              icon={<Server className="w-6 h-6" />}
              health={components.redis}
            />
            <ComponentCard
              name="Indexer Worker"
              icon={<Zap className="w-6 h-6" />}
              health={components.worker}
            />
          </div>
        </div>

        {/* Circuit Breaker Status */}
        {circuitBreaker && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Circuit Breaker</h2>
            <div className="bg-white p-6 rounded-lg border-2 border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-700 font-medium">State:</span>
                <span className={`text-xl font-bold ${getCircuitBreakerColor(circuitBreaker.state)}`}>
                  {circuitBreaker.state}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {Object.entries(circuitBreaker.metrics).map(([key, value]) => (
                  <div key={key} className="text-center">
                    <div className="text-gray-600">{key}</div>
                    <div className="text-2xl font-bold text-gray-900">{String(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Metrics */}
        {metrics && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Metrics</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-6 rounded-lg border-2 border-gray-200">
                <h3 className="text-gray-700 font-medium mb-3">Events</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Last 1 hour:</span>
                    <span className="font-bold">{metrics.events.last1Hour}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Last 24 hours:</span>
                    <span className="font-bold">{metrics.events.last24Hours}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg border-2 border-gray-200">
                <h3 className="text-gray-700 font-medium mb-3">Translations</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Success rate:</span>
                    <span className="font-bold">{metrics.translations.successRate}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Avg latency:</span>
                    <span className="font-bold">{metrics.translations.averageLatencyMs}ms</span>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg border-2 border-gray-200">
                <h3 className="text-gray-700 font-medium mb-3">WebSocket</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Active connections:</span>
                    <span className="font-bold">{metrics.websocket.activeConnections}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Health Check Summary */}
        <div className="bg-white p-6 rounded-lg border-2 border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Health Check Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-gray-600 text-sm">Total Checks</div>
              <div className="text-3xl font-bold text-gray-900">{checks.totalChecks}</div>
            </div>
            <div className="text-center">
              <div className="text-gray-600 text-sm">Passed</div>
              <div className="text-3xl font-bold text-green-600">{checks.passedChecks}</div>
            </div>
            <div className="text-center">
              <div className="text-gray-600 text-sm">Failed</div>
              <div className="text-3xl font-bold text-red-600">{checks.failedChecks}</div>
            </div>
            <div className="text-center">
              <div className="text-gray-600 text-sm">Duration</div>
              <div className="text-3xl font-bold text-blue-600">{checks.durationMs}ms</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-600">
          <p>Last updated: {lastUpdated ? formatTimestamp(lastUpdated.toISOString()) : formatTimestamp(timestamp)}</p>
          <p className="mt-2">Auto-refresh: {autoRefresh ? "Every 30 seconds" : "Disabled"}</p>
        </div>
      </div>
    </div>
  );
}
