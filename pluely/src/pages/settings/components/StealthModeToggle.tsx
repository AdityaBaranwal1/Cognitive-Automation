import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EyeOff, Eye } from "lucide-react";
import { safeLocalStorage } from "@/lib";

const STORAGE_KEY = "stealth_mode_enabled";

export const StealthModeToggle = () => {
    const [enabled, setEnabled] = useState(true);

    useEffect(() => {
        const saved = safeLocalStorage.getItem(STORAGE_KEY);
        if (saved !== null) {
            const isEnabled = saved === "true";
            setEnabled(isEnabled);
            updateContentProtection(isEnabled);
        } else {
            // Default to true (stealth mode on)
            updateContentProtection(true);
        }
    }, []);

    const updateContentProtection = async (isEnabled: boolean) => {
        try {
            await invoke("set_content_protection", { enabled: isEnabled });
        } catch (error) {
            console.error("Failed to set content protection:", error);
        }
    };

    const handleToggle = (checked: boolean) => {
        setEnabled(checked);
        safeLocalStorage.setItem(STORAGE_KEY, String(checked));
        updateContentProtection(checked);
    };

    return (
        <div className="flex items-center justify-between space-x-2 border rounded-lg p-4">
            <div className="flex items-center space-x-4">
                <div className="bg-primary/10 p-2 rounded-lg">
                    {enabled ? (
                        <EyeOff className="h-5 w-5 text-primary" />
                    ) : (
                        <Eye className="h-5 w-5 text-primary" />
                    )}
                </div>
                <div className="space-y-1">
                    <Label htmlFor="stealth-mode" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        Stealth Mode
                    </Label>
                    <p className="text-xs text-muted-foreground">
                        {enabled
                            ? "App is invisible to screenshots and screen sharing."
                            : "App is visible in screenshots and screen sharing."}
                    </p>
                </div>
            </div>
            <Switch
                id="stealth-mode"
                checked={enabled}
                onCheckedChange={handleToggle}
            />
        </div>
    );
};
