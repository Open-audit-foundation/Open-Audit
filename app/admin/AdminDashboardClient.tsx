"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AdminDashboardClient() {
  const [securityMetrics, setSecurityMetrics] = useState<any>(null);
  const [resilienceMetrics, setResilienceMetrics] = useState<any>(null);
  const [wasmStats, setWasmStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [secRes, resRes, wasmRes] = await Promise.all([
          fetch("/api/security/metrics").catch(() => null),
          fetch("/api/resilience/metrics").catch(() => null),
          fetch("/api/wasm/stats").catch(() => null),
        ]);

        if (secRes?.ok) {
          setSecurityMetrics(await secRes.json());
        } else {
          setSecurityMetrics(null);
        }

        if (resRes?.ok) {
          setResilienceMetrics(await resRes.json());
        } else {
          setResilienceMetrics(null);
        }

        if (wasmRes?.ok) {
          setWasmStats(await wasmRes.json());
        } else {
          setWasmStats(null);
        }
      } catch (e) {
        console.error("Dashboard fetch error", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading admin dashboard data...
      </div>
    );
  }

  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="security">Security Guards</TabsTrigger>
        <TabsTrigger value="resilience">Resilience (Circuit Breaker)</TabsTrigger>
        <TabsTrigger value="wasm">WASM Sandbox</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Security Status</CardTitle>
              <CardDescription>XDR Parser Guards</CardDescription>
            </CardHeader>
            <CardContent>
              {securityMetrics ? (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Status</span>
                    <Badge variant={securityMetrics.status === "healthy" ? "default" : "destructive"}>
                      {securityMetrics.status?.toUpperCase() || "UNKNOWN"}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Total Parses: {securityMetrics.metrics?.totalParses || 0}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">No security data available. Module may be inactive.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Circuit Breaker</CardTitle>
              <CardDescription>Upstream RPC Health</CardDescription>
            </CardHeader>
            <CardContent>
              {resilienceMetrics ? (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Status</span>
                    <Badge variant={resilienceMetrics.health?.healthy ? "default" : "destructive"}>
                      {resilienceMetrics.health?.healthy ? "HEALTHY" : "DEGRADED"}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Available Tokens: {resilienceMetrics.health?.rateLimiter?.availableTokens || 0}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">No resilience data available.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>WASM Sandbox</CardTitle>
              <CardDescription>Execution Stats</CardDescription>
            </CardHeader>
            <CardContent>
              {wasmStats ? (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Total Executions</span>
                    <span className="font-bold">{wasmStats.stats?.totalExecutions || 0}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-green-500">Success</span>
                    <span>{wasmStats.stats?.successful || 0}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-red-500">Failures / Timeouts</span>
                    <span>{(wasmStats.stats?.failures || 0) + (wasmStats.stats?.timeouts || 0)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">No WASM stats available. Sandbox may be inactive.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="security" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>XDR Parser Guard Trips</CardTitle>
            <CardDescription>Detailed view of security metrics</CardDescription>
          </CardHeader>
          <CardContent>
            {securityMetrics ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="font-medium">Errors Breakdown</h3>
                  {securityMetrics.errors?.byType && Object.entries(securityMetrics.errors.byType).length > 0 ? (
                    Object.entries(securityMetrics.errors.byType).map(([type, count]) => (
                      <div key={type} className="flex justify-between items-center border-b pb-1 text-sm">
                        <span>{type}</span>
                        <Badge variant="destructive">{count as number}</Badge>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">No errors detected.</div>
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="font-medium">Performance Metrics</h3>
                  <div className="flex justify-between text-sm border-b pb-1">
                    <span>Max Depth Reached</span>
                    <span>{securityMetrics.performance?.maxDepthReached || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-1">
                    <span>Max Payload Size</span>
                    <span>{securityMetrics.performance?.maxPayloadSizeSeen || 0} bytes</span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-1">
                    <span>Max Parse Time</span>
                    <span>{securityMetrics.performance?.maxParseTimeSeen || 0} ms</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic text-center py-8">No security data available. Module may be inactive.</div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="resilience" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Circuit Breaker & Token Bucket</CardTitle>
            <CardDescription>Resilience Layer Metrics</CardDescription>
          </CardHeader>
          <CardContent>
            {resilienceMetrics ? (
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="font-medium mb-3">Circuit States per Upstream</h3>
                  <div className="space-y-3">
                    {resilienceMetrics.health?.circuitStates?.map((cs: any) => (
                      <div key={cs.endpoint} className="p-3 border rounded-lg flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-sm">{cs.endpoint}</span>
                          <Badge variant={cs.state === "CLOSED" ? "default" : cs.state === "HALF_OPEN" ? "secondary" : "destructive"}>
                            {cs.state}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Failures: {cs.failures}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-medium mb-3">Rate Limiting (Token Bucket)</h3>
                  <div className="space-y-2 p-4 border rounded-lg bg-card">
                    <div className="flex justify-between text-sm border-b pb-2">
                      <span>Available Tokens</span>
                      <span className="font-bold">{resilienceMetrics.health?.rateLimiter?.availableTokens || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm pt-2">
                      <span>Queued Requests (Throttled)</span>
                      <span>{resilienceMetrics.health?.rateLimiter?.queuedRequests || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic text-center py-8">No resilience data available.</div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="wasm" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>WASM Sandbox Statistics</CardTitle>
            <CardDescription>Execution success, failure, and timeout counts</CardDescription>
          </CardHeader>
          <CardContent>
            {wasmStats ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 border rounded-lg">
                    <span className="text-sm">Total Executions</span>
                    <span className="font-bold">{wasmStats.stats?.totalExecutions || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 border rounded-lg bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900">
                    <span className="text-sm">Successful</span>
                    <span className="font-bold">{wasmStats.stats?.successful || 0}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 border rounded-lg bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900">
                    <span className="text-sm">Failures</span>
                    <span className="font-bold">{wasmStats.stats?.failures || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 border rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-900">
                    <span className="text-sm">Timeouts</span>
                    <span className="font-bold">{wasmStats.stats?.timeouts || 0}</span>
                  </div>
                </div>
                <div className="col-span-1 md:col-span-2 pt-4">
                  <h3 className="font-medium text-sm mb-2 text-muted-foreground">Performance</h3>
                  <div className="flex gap-4">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Avg Time: </span>
                      {wasmStats.stats?.averageExecutionTimeMs || 0}ms
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Peak Memory: </span>
                      {wasmStats.stats?.peakMemoryUsageBytes ? (wasmStats.stats.peakMemoryUsageBytes / 1024).toFixed(2) : 0} KB
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic text-center py-8">No WASM data available. Module may be inactive.</div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
