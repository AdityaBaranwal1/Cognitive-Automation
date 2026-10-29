import {
  Theme,
  AlwaysOnTopToggle,
  AppIconToggle,
  AutostartToggle,
  StealthModeToggle,
} from "./components";
import { ScreenshotConfigs } from "../screenshot/components";
import { PageLayout } from "@/layouts";
import { useSettings } from "@/hooks";
import { Header, Selection } from "@/components";
import { LANGUAGES } from "@/lib";
import { updateLanguage } from "@/lib/storage/response-settings.storage";
import { getResponseSettings } from "@/lib";
import { useState, useEffect, useMemo } from "react";

const Settings = () => {
  const settings = useSettings();

  // Language state
  const [selectedLanguage, setSelectedLanguage] = useState<string>("english");

  useEffect(() => {
    const responseSettings = getResponseSettings();
    setSelectedLanguage(responseSettings.language);
  }, []);

  const handleLanguageChange = (languageId: string) => {
    setSelectedLanguage(languageId);
    updateLanguage(languageId);
  };

  const languageOptions = useMemo(() => {
    return LANGUAGES.map((lang) => ({
      label: `${lang.flag} ${lang.name}`,
      value: lang.id,
    }));
  }, []);

  return (
    <PageLayout title="Settings" description="Manage your settings">
      {/* Theme */}
      <Theme />

      {/* Autostart Toggle */}
      <AutostartToggle />

      {/* Stealth Mode Toggle */}
      <StealthModeToggle />

      {/* App Icon Toggle */}
      <AppIconToggle />

      {/* Always On Top Toggle */}
      <AlwaysOnTopToggle />

      {/* Response Language */}
      <div className="space-y-4">
        <Header
          title="Response Language"
          description="Select the language for AI responses. Setting applies globally to all providers and conversations"
          isMainTitle
        />

        <div className="max-w-md">
          <Selection
            selected={selectedLanguage}
            onChange={handleLanguageChange}
            options={languageOptions}
            placeholder="Select a language"
            disabled={false}
          />
        </div>
      </div>

      {/* Screenshot Settings */}
      <ScreenshotConfigs {...settings} />
    </PageLayout>
  );
};

export default Settings;
