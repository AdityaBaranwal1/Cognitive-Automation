import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib";
import { IAudioContextType } from "@/types";
import {
    ReactNode,
    createContext,
    useContext,
    useEffect,
    useState,
} from "react";

// Create the context
const AudioContext = createContext<IAudioContextType | undefined>(undefined);

// Create the provider component
export const AudioProvider = ({ children }: { children: ReactNode }) => {
    const [selectedAudioDevices, setSelectedAudioDevices] = useState<{
        input: string;
        output: string;
    }>({
        input:
            safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_AUDIO_INPUT_DEVICE) || "",
        output:
            safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_AUDIO_OUTPUT_DEVICE) || "",
    });

    // Persist audio device selections to localStorage
    useEffect(() => {
        if (selectedAudioDevices.input) {
            safeLocalStorage.setItem(
                STORAGE_KEYS.SELECTED_AUDIO_INPUT_DEVICE,
                selectedAudioDevices.input
            );
        }
        if (selectedAudioDevices.output) {
            safeLocalStorage.setItem(
                STORAGE_KEYS.SELECTED_AUDIO_OUTPUT_DEVICE,
                selectedAudioDevices.output
            );
        }
    }, [selectedAudioDevices]);

    const value: IAudioContextType = {
        selectedAudioDevices,
        setSelectedAudioDevices,
    };

    return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
};

// Create a hook to access the context
export const useAudio = () => {
    const context = useContext(AudioContext);

    if (!context) {
        throw new Error("useAudio must be used within an AudioProvider");
    }

    return context;
};
