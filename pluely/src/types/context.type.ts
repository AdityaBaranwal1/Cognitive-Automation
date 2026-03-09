import { Dispatch, SetStateAction } from "react";
import { ScreenshotConfig, TYPE_PROVIDER, Workflow, WorkflowExecution } from "@/types";
import { CursorType, CustomizableState } from "@/lib/storage";

// --- Isolated context types ---

export type IConfigContextType = {
  systemPrompt: string;
  setSystemPrompt: Dispatch<SetStateAction<string>>;
  allAiProviders: TYPE_PROVIDER[];
  customAiProviders: TYPE_PROVIDER[];
  selectedAIProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedAIProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  allSttProviders: TYPE_PROVIDER[];
  customSttProviders: TYPE_PROVIDER[];
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedSttProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  screenshotConfiguration: ScreenshotConfig;
  setScreenshotConfiguration: React.Dispatch<
    React.SetStateAction<ScreenshotConfig>
  >;
  customizable: CustomizableState;
  toggleAppIconVisibility: (isVisible: boolean) => Promise<void>;
  toggleAlwaysOnTop: (isEnabled: boolean) => Promise<void>;
  toggleAutostart: (isEnabled: boolean) => Promise<void>;
  loadData: () => void;
  setCursorType: (type: CursorType) => void;
};

export type IAudioContextType = {
  selectedAudioDevices: {
    input: string;
    output: string;
  };
  setSelectedAudioDevices: Dispatch<
    SetStateAction<{
      input: string;
      output: string;
    }>
  >;
};

export type IWorkflowContextType = {
  workflows: Workflow[];
  saveWorkflow: (workflow: Workflow) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  updateWorkflow: (workflow: Workflow) => Promise<void>;
  workflowExecution: WorkflowExecution | null;
  setWorkflowExecution: React.Dispatch<React.SetStateAction<WorkflowExecution | null>>;
};

// --- Backward-compatible combined type ---
export type IContextType = IConfigContextType & IAudioContextType & IWorkflowContextType;
