import { Header } from "@/components";
import { UseSettingsReturn } from "@/types";
import { Providers } from "./Providers";
import { CustomProviders } from "./CustomProvider";

export const AIProviders = (settings: UseSettingsReturn) => {
  return (
    <div id="ai-providers" className="space-y-3">
      <Header
        title="AI Providers"
        description="Select your preferred AI service provider to get started."
        isMainTitle
      />

      {/* Default Provider Selection - Prominent card at top */}
      <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-4">
        <Providers {...settings} />
      </div>

      {/* Custom Providers - Configuration section below */}
      <CustomProviders {...settings} />
    </div>
  );
};
