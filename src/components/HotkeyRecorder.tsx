import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";

interface HotkeyRecorderProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

export const HotkeyRecorder = ({
    value,
    onChange,
    placeholder = "Click to record hotkey",
    className,
}: HotkeyRecorderProps) => {
    const [isRecording, setIsRecording] = useState(false);

    const formatHotkey = (keyEvent: KeyboardEvent): string | null => {
        const modifiers: string[] = [];
        if (keyEvent.ctrlKey) modifiers.push("CommandOrControl");
        if (keyEvent.shiftKey) modifiers.push("Shift");
        if (keyEvent.altKey) modifiers.push("Alt");
        if (keyEvent.metaKey) modifiers.push("Super");

        let key = keyEvent.key;

        // Ignore modifier keys themselves
        if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;

        // Convert key to uppercase for display consistency
        key = key.toUpperCase();

        // Handle special keys mapping if needed (Tauri format)
        // For now, basic keys work fine.

        if (modifiers.length === 0 && key.length === 1) {
            // Single letter hotkey? Maybe allow, but usually modifiers are preferred.
            // For now allow it.
        }

        return [...modifiers, key].join("+");
    };

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (!isRecording) return;

            e.preventDefault();
            e.stopPropagation();

            const hotkey = formatHotkey(e);
            if (hotkey) {
                onChange(hotkey);
                setIsRecording(false);
            }
        },
        [isRecording, onChange]
    );

    useEffect(() => {
        if (isRecording) {
            // FIX: Use capture phase (true) to intercept F-keys before browser handles them
            // This prevents F5 from refreshing, F12 from opening devtools, etc during recording
            window.addEventListener("keydown", handleKeyDown, true);
        }

        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [isRecording, handleKeyDown]);

    return (
        <div className={cn("flex items-center gap-2", className)}>
            <Button
                variant={isRecording ? "destructive" : "outline"}
                className={cn("w-full justify-start font-mono", isRecording && "animate-pulse")}
                onClick={() => setIsRecording(!isRecording)}
            >
                {isRecording
                    ? "Press keys..."
                    : value || <span className="text-muted-foreground">{placeholder}</span>}
            </Button>
            {value && (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onChange("")}
                    title="Clear hotkey"
                >
                    <XIcon className="h-4 w-4" />
                </Button>
            )}
        </div>
    );
};
