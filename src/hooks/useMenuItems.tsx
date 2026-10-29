import {
  Settings,
  Code,
  MessagesSquare,
  WandSparkles,
  AudioLinesIcon,
  SquareSlashIcon,
  HomeIcon,
  PowerIcon,
  BugIcon,
  Workflow,
  BrainIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

export const useMenuItems = () => {

  const menu: {
    icon: React.ElementType;
    label: string;
    href: string;
    count?: number;
  }[] = [
      {
        icon: HomeIcon,
        label: "Dashboard",
        href: "/dashboard",
      },
      {
        icon: MessagesSquare,
        label: "Chats",
        href: "/chats",
      },
      {
        icon: WandSparkles,
        label: "System prompts",
        href: "/system-prompts",
      },
      {
        icon: Settings,
        label: "App Settings",
        href: "/settings",
      },
      {
        icon: BrainIcon,
        label: "Model Profiles",
        href: "/context",
      },
      {
        icon: AudioLinesIcon,
        label: "Audio",
        href: "/audio",
      },
      {
        icon: SquareSlashIcon,
        label: "Cursor & Shortcuts",
        href: "/shortcuts",
      },

      {
        icon: Workflow,
        label: "Workflows",
        href: "/workflows",
      },
      {
        icon: Code,
        label: "Dev space",
        href: "/dev-space",
      },
    ];

  const footerItems = [
    {
      icon: BugIcon,
      label: "Report a bug",
      href: "#",
    },
    {
      icon: PowerIcon,
      label: "Quit",
      action: async () => {
        await invoke("exit_app");
      },
    },
  ];

  const footerLinks: {
    title: string;
    icon: React.ElementType;
    link: string;
  }[] = [];

  return {
    menu,
    footerItems,
    footerLinks,
  };
};
