import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import {
  Dashboard,
  App,
  SystemPrompts,
  ViewChat,
  Settings,
  DevSpace,
  Shortcuts,
  Audio,
  Chats,
  WorkflowEditor,
  Context,
} from "@/pages";
import { DashboardLayout } from "@/layouts";

import { useWorkflowRunner } from "@/hooks";

export default function AppRoutes() {
  useWorkflowRunner();

  return (
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/workflows" element={<WorkflowEditor />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/system-prompts" element={<SystemPrompts />} />
          <Route path="/chats/view/:conversationId" element={<ViewChat />} />
          <Route path="/shortcuts" element={<Shortcuts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audio" element={<Audio />} />
          <Route path="/dev-space" element={<DevSpace />} />
          <Route path="/context" element={<Context />} />
        </Route>
      </Routes>
    </Router>
  );
}
