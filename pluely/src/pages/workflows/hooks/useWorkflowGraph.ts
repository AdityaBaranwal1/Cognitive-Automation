import { useMemo, useCallback, useEffect } from 'react';
import { Node, Edge, useNodesState, useEdgesState, Connection, addEdge } from '@xyflow/react';
import { Workflow, WorkflowStep, WorkflowExecutionStatus } from '@/types';
import { useWorkflow } from '@/contexts';

// Node data type matching our step types
export interface WorkflowNodeData {
    stepId: string;
    type: WorkflowStep['type'];
    config: WorkflowStep['config'];
    label: string;
    name?: string;
    isActive: boolean;
    executionStatus: WorkflowExecutionStatus | null;
    [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
}

// Convert workflow steps to React Flow nodes
function stepsToNodes(steps: WorkflowStep[], activeStepId?: string | null, executionStatus?: WorkflowExecutionStatus | null): Node<WorkflowNodeData>[] {
    return steps.map((step, index) => ({
        id: step.id,
        type: 'default', // Use default node type initially, custom types in Phase 8B
        position: { x: 250, y: index * 120 }, // Vertical layout
        data: {
            stepId: step.id,
            type: step.type,
            config: step.config,
            label: getStepLabel(step),
            name: step.name,
            isActive: step.id === activeStepId,
            executionStatus: step.id === activeStepId ? (executionStatus || null) : null,
        },
    }));
}

// Convert workflow steps to edges (linear chain)
function stepsToEdges(steps: WorkflowStep[]): Edge[] {
    const edges: Edge[] = [];
    for (let i = 0; i < steps.length - 1; i++) {
        edges.push({
            id: `e-${steps[i].id}-${steps[i + 1].id}`,
            source: steps[i].id,
            target: steps[i + 1].id,
            type: 'smoothstep',
        });
    }
    return edges;
}

// Get human-readable label for step
function getStepLabel(step: WorkflowStep): string {
    switch (step.type) {
        case 'capture_screen':
            return 'Capture Screen';
        case 'ai_process':
            return 'AI Process';
        case 'wait':
            return `Wait ${(step.config as any)?.duration_ms || 0}ms`;
        case 'loop':
            return `Loop ${(step.config as any)?.iterations || 0}x`;
        case 'await_input':
            return 'Await Input';
        case 'keypress':
            return `Keypress: ${(step.config as any)?.key || '?'}`;
        case 'action_notification':
        case 'system_action':
            return 'Action';
        default:
            return step.type;
    }
}

// Convert nodes/edges back to steps (for saving)
function nodesToSteps(nodes: Node<WorkflowNodeData>[], edges: Edge[]): WorkflowStep[] {
    // Build adjacency list from edges
    const nextMap = new Map<string, string>();
    edges.forEach(edge => nextMap.set(edge.source, edge.target));

    // Find start node (no incoming edges)
    const hasIncoming = new Set(edges.map(e => e.target));
    const startNode = nodes.find(n => !hasIncoming.has(n.id));

    if (!startNode) return [];

    // Traverse and build ordered steps
    const orderedSteps: WorkflowStep[] = [];
    let currentId: string | undefined = startNode.id;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const node = nodes.find(n => n.id === currentId);
        if (node) {
            orderedSteps.push({
                id: node.data.stepId,
                name: node.data.name,
                type: node.data.type,
                config: node.data.config,
            });
        }
        currentId = nextMap.get(currentId);
    }

    return orderedSteps;
}

export function useWorkflowGraph(workflow: Workflow | null) {
    const { workflowExecution } = useWorkflow();

    // Determine if this workflow is currently executing
    const activeStepId = workflowExecution?.workflowId === workflow?.id ? workflowExecution?.activeStepId : null;
    const executionStatus = workflowExecution?.workflowId === workflow?.id ? workflowExecution?.status : null;

    // Initial nodes and edges from workflow
    const initialNodes = useMemo(
        () => (workflow?.steps ? stepsToNodes(workflow.steps, activeStepId, executionStatus) : []),
        [workflow?.id] // Only recalculate when workflow changes
    );

    const initialEdges = useMemo(
        () => (workflow?.steps ? stepsToEdges(workflow.steps) : []),
        [workflow?.id]
    );

    // React Flow state
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Update node active states when execution state changes
    useEffect(() => {
        setNodes(currentNodes =>
            currentNodes.map(node => ({
                ...node,
                data: {
                    ...node.data,
                    isActive: node.data.stepId === activeStepId,
                    executionStatus: node.data.stepId === activeStepId ? (executionStatus || null) : null,
                },
            }))
        );
    }, [activeStepId, executionStatus, setNodes]);

    // Handle new connections
    const onConnect = useCallback(
        (connection: Connection) => {
            setEdges((eds) => addEdge({ ...connection, type: 'smoothstep' }, eds));
        },
        [setEdges]
    );

    // Convert current graph state back to steps
    const getSteps = useCallback((): WorkflowStep[] => {
        return nodesToSteps(nodes, edges);
    }, [nodes, edges]);

    // Sync with workflow changes
    const syncFromWorkflow = useCallback((workflow: Workflow) => {
        setNodes(stepsToNodes(workflow.steps, activeStepId, executionStatus));
        setEdges(stepsToEdges(workflow.steps));
    }, [setNodes, setEdges, activeStepId, executionStatus]);

    return {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        getSteps,
        syncFromWorkflow,
    };
}
