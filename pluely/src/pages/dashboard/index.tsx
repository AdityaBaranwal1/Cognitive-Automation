import { PageLayout } from "@/layouts";
import { Usage } from "./components";
import { getUsageSummary, clearApiUsage } from "@/lib/storage/api-usage.storage";
import { useState, useCallback } from "react";

const Dashboard = () => {
  const [summary, setSummary] = useState(() => getUsageSummary(30));
  const [loading, setLoading] = useState(false);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      setSummary(getUsageSummary(30));
      setLoading(false);
    }, 300);
  }, []);

  const handleClear = useCallback(() => {
    clearApiUsage();
    setSummary(getUsageSummary(30));
  }, []);

  return (
    <PageLayout
      title="Dashboard"
      description="Overview of your local API activity and usage"
    >
      <Usage
        loading={loading}
        onRefresh={handleRefresh}
        onClear={handleClear}
        summary={summary}
      />
    </PageLayout>
  );
};

export default Dashboard;
