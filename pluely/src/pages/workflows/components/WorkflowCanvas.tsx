import { useCallback, useMemo } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Workflow } from '@/types';
import { useWorkflowGraph } from '../hooks/useWorkflowGraph';
import { WorkflowNode } from './nodes';

// Custom node types - all step types use the same WorkflowNode component
// Using 'default' as the key since our hook sets type: 'default' for all nodes

interface WorkflowCanvasProps {
    workflow: Workflow | null;
    onStepsChange?: (steps: Workflow['steps']) => void;
    onNodeClick?: (stepId: string) => void;
}

export function WorkflowCanvas({ workflow, onStepsChange: _onStepsChange, onNodeClick }: WorkflowCanvasProps) {
    // Register custom node types - memoized to prevent re-renders
    const nodeTypes = useMemo(() => ({
        default: WorkflowNode,
    }), []);

    const {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
    } = useWorkflowGraph(workflow);

    const handleNodeClick = useCallback(
        (_: React.MouseEvent, node: any) => {
            onNodeClick?.(node.data.stepId);
        },
        [onNodeClick]
    );

    if (!workflow) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                Select a workflow to view
            </div>
        );
    }

    return (
        <div className="w-full h-full min-h-[500px]">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                defaultEdgeOptions={{
                    type: 'smoothstep',
                    animated: true,
                }}
            >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
                <Controls />
                <MiniMap
                    nodeColor="#6366f1"
                    maskColor="rgba(0, 0, 0, 0.8)"
                />
            </ReactFlow>
        </div>
    );
}
