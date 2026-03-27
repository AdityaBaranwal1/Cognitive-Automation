import { Header } from "@/components";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UseSettingsReturn } from "@/types";
import { QuickSetup } from "./QuickSetup";
import { StandardSetup } from "./StandardSetup";
import { Providers } from "./Providers";
import { AllProviders } from "./AllProviders";

export const AIProviders = (settings: UseSettingsReturn) => {
  return (
    <div id="ai-providers" className="space-y-3">
      <Header
        title="AI Providers"
        description="Add provider configurations with Quick Setup, or use Advanced for custom cURL endpoints."
        isMainTitle
      />

      <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-4">
        <Tabs defaultValue="quick">
          <TabsList className="w-full">
            <TabsTrigger value="quick">Quick Setup</TabsTrigger>
            <TabsTrigger value="standard">Select Provider</TabsTrigger>
            <TabsTrigger value="advanced">Advanced (cURL)</TabsTrigger>
          </TabsList>

          <TabsContent value="quick" className="pt-4">
            <QuickSetup {...settings} />
          </TabsContent>

          <TabsContent value="standard" className="pt-4">
            <StandardSetup {...settings} />
          </TabsContent>

          <TabsContent value="advanced" className="pt-4">
            <Providers {...settings} />
          </TabsContent>
        </Tabs>
      </div>

      {/* All saved provider configurations */}
      <AllProviders />
    </div>
  );
};
