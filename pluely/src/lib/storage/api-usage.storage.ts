
export interface ApiUsageEntry {
    timestamp: number;
    providerId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    workflowId?: string;
    workflowName?: string;
}

export interface UsageSummary {
    totalRequests: number;
    totalTokens: number;
    byProvider: Record<string, { requests: number; tokens: number }>;
    byModel: Record<string, { requests: number; tokens: number }>;
    dailyData: { date: string; requests: number; tokens: number }[];
}

const USAGE_KEY = "api_usage_log";
const MAX_ENTRIES = 5000; // Cap to prevent localStorage bloat

/**
 * Log an API usage entry
 */
export const logApiUsage = (entry: Omit<ApiUsageEntry, "timestamp">): void => {
    try {
        const entries = getRawUsageEntries();
        entries.push({ ...entry, timestamp: Date.now() });

        // Trim old entries if over cap
        if (entries.length > MAX_ENTRIES) {
            entries.splice(0, entries.length - MAX_ENTRIES);
        }

        localStorage.setItem(USAGE_KEY, JSON.stringify(entries));
    } catch (error) {
        console.error("Failed to log API usage:", error);
    }
};

/**
 * Get raw usage entries (internal)
 */
const getRawUsageEntries = (): ApiUsageEntry[] => {
    try {
        const stored = localStorage.getItem(USAGE_KEY);
        if (!stored) return [];
        return JSON.parse(stored);
    } catch {
        return [];
    }
};

/**
 * Get all usage entries, optionally filtered by date range
 */
export const getApiUsage = (daysBack: number = 30): ApiUsageEntry[] => {
    const entries = getRawUsageEntries();
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    return entries.filter((e) => e.timestamp >= cutoff);
};

/**
 * Get aggregated usage summary for the dashboard
 */
export const getUsageSummary = (daysBack: number = 30): UsageSummary => {
    const entries = getApiUsage(daysBack);

    const byProvider: Record<string, { requests: number; tokens: number }> = {};
    const byModel: Record<string, { requests: number; tokens: number }> = {};
    const dailyMap: Record<string, { requests: number; tokens: number }> = {};

    let totalRequests = 0;
    let totalTokens = 0;

    for (const entry of entries) {
        totalRequests++;
        totalTokens += entry.totalTokens;

        // By provider
        if (!byProvider[entry.providerId]) {
            byProvider[entry.providerId] = { requests: 0, tokens: 0 };
        }
        byProvider[entry.providerId].requests++;
        byProvider[entry.providerId].tokens += entry.totalTokens;

        // By model
        if (!byModel[entry.model]) {
            byModel[entry.model] = { requests: 0, tokens: 0 };
        }
        byModel[entry.model].requests++;
        byModel[entry.model].tokens += entry.totalTokens;

        // Daily aggregation
        const dateStr = new Date(entry.timestamp).toISOString().split("T")[0];
        if (!dailyMap[dateStr]) {
            dailyMap[dateStr] = { requests: 0, tokens: 0 };
        }
        dailyMap[dateStr].requests++;
        dailyMap[dateStr].tokens += entry.totalTokens;
    }

    // Build daily data sorted by date
    const dailyData = Object.entries(dailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({ date, ...data }));

    return {
        totalRequests,
        totalTokens,
        byProvider,
        byModel,
        dailyData,
    };
};

/**
 * Clear all usage data
 */
export const clearApiUsage = (): void => {
    localStorage.removeItem(USAGE_KEY);
};
