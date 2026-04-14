export function createRequestTimer(scope: string, requestId: string) {
  const startedAt = Date.now();

  const stage = (name: string, stageStartedAt: number, meta?: Record<string, unknown>) => {
    console.log(`[${scope}][${requestId}] ${name}`, {
      durationMs: Date.now() - stageStartedAt,
      ...(meta ?? {}),
    });
  };

  const total = (name: string, meta?: Record<string, unknown>) => {
    console.log(`[${scope}][${requestId}] ${name}`, {
      durationMs: Date.now() - startedAt,
      ...(meta ?? {}),
    });
  };

  return { startedAt, stage, total };
}
