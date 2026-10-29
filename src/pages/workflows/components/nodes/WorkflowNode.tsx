import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, Loader2 } from 'lucide-react';
import type { WorkflowNodeData } from '../../hooks/useWorkflowGraph';
import type { WorkflowExecutionStatus, WorkflowStep } from '@/types';
import { getStepSummary } from '@/workflow/core/registry';
import { getStepIcon, getStepColor, getStepTooltip } from '@/workflow/ui/registry-ui';

function buildStepForRegistry(data: WorkflowNodeData): WorkflowStep {
    return {
        id: data.stepId,
        type: data.type,
        name: data.name,
        config: data.config,
    } as WorkflowStep;
}

interface WorkflowNodeProps extends NodeProps {
    data: WorkflowNodeData;
}

// Get status label for active nodes
function getStatusLabel(status: WorkflowExecutionStatus | null): string {
    switch (status) {
        case 'ai_thinking': return 'AI Thinking...';
        case 'capturing': return 'Capturing...';
        case 'waiting': return 'Waiting...';
        case 'running': return 'Running...';
        case 'completed': return 'Done';
        case 'error': return 'Error';
        default: return '';
    }
}

export function WorkflowNode({ data, selected }: WorkflowNodeProps) {
    const [isHovered, setIsHovered] = useState(false);
    const stepForRegistry = buildStepForRegistry(data);
    const Icon = getStepIcon(data.type) || Zap;
    const summary = getStepSummary(stepForRegistry);
    const accentColor = getStepColor(data.type);
    const tooltipContent = getStepTooltip(stepForRegistry);
    const isActive = data.isActive;
    const executionStatus = data.executionStatus;

    // User's custom name (from step.name) vs system type label
    const userName = data.name && data.name.trim() ? data.name : null;
    const systemType = data.label;

    return (
        <div
            style={{ position: 'relative' }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Hover Tooltip */}
            {isHovered && tooltipContent && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        marginBottom: 8,
                        padding: '10px 14px',
                        background: 'rgba(15,15,20,0.98)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 8,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                        minWidth: 160,
                        maxWidth: 240,
                        zIndex: 1000,
                        pointerEvents: 'none',
                    }}
                >
                    {tooltipContent}
                    {/* Arrow */}
                    <div
                        style={{
                            position: 'absolute',
                            bottom: -6,
                            left: '50%',
                            transform: 'translateX(-50%) rotate(45deg)',
                            width: 10,
                            height: 10,
                            background: 'rgba(15,15,20,0.98)',
                            borderRight: '1px solid rgba(255,255,255,0.15)',
                            borderBottom: '1px solid rgba(255,255,255,0.15)',
                        }}
                    />
                </div>
            )}

            {/* Main Node */}
            <div
                style={{
                    minWidth: 200,
                    maxWidth: 260,
                    padding: '12px 16px',
                    borderRadius: 12,
                    border: `2px solid ${isActive ? accentColor : selected ? accentColor : 'rgba(255,255,255,0.1)'}`,
                    background: isActive
                        ? `linear-gradient(135deg, rgba(0,0,0,0.95) 0%, rgba(30,30,40,0.95) 100%)`
                        : selected
                            ? `linear-gradient(135deg, rgba(0,0,0,0.95) 0%, rgba(30,30,40,0.95) 100%)`
                            : 'rgba(20,20,25,0.95)',
                    boxShadow: isActive
                        ? `0 0 20px ${accentColor}60, 0 0 40px ${accentColor}30, 0 4px 12px rgba(0,0,0,0.5)`
                        : selected
                            ? `0 0 20px ${accentColor}40, 0 4px 12px rgba(0,0,0,0.5)`
                            : '0 4px 12px rgba(0,0,0,0.3)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    animation: isActive ? 'workflow-node-pulse 2s ease-in-out infinite' : 'none',
                    position: 'relative',
                    overflow: 'visible',
                }}
            >
                {/* Input Handle */}
                <Handle
                    type="target"
                    position={Position.Top}
                    style={{
                        width: 10,
                        height: 10,
                        background: '#666',
                        border: '2px solid #1a1a1a',
                    }}
                />

                {/* Node Content */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Icon Container */}
                    <div
                        style={{
                            padding: 8,
                            borderRadius: 8,
                            background: `${accentColor}20`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <Icon style={{ width: 18, height: 18, color: accentColor }} />
                    </div>

                    {/* Text Content - 3 levels */}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 1 }}>
                        {/* Primary: User's custom name OR system type */}
                        <span
                            style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: '#fff',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                lineHeight: 1.3,
                            }}
                        >
                            {userName || systemType}
                        </span>

                        {/* Secondary: System type (only if user name exists) */}
                        {userName && (
                            <span
                                style={{
                                    fontSize: 11,
                                    color: accentColor,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    lineHeight: 1.2,
                                }}
                            >
                                {systemType}
                            </span>
                        )}

                        {/* Tertiary: Technical details */}
                        {summary && (
                            <span
                                style={{
                                    fontSize: 10,
                                    color: 'rgba(255,255,255,0.45)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    lineHeight: 1.2,
                                }}
                            >
                                {summary}
                            </span>
                        )}
                    </div>
                </div>

                {/* Active Status Badge */}
                {isActive && executionStatus && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 8,
                        padding: '4px 8px',
                        borderRadius: 6,
                        background: `${accentColor}15`,
                        border: `1px solid ${accentColor}30`,
                    }}>
                        <Loader2 style={{
                            width: 12,
                            height: 12,
                            color: accentColor,
                            animation: 'spin 1s linear infinite',
                        }} />
                        <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: accentColor,
                            letterSpacing: '0.02em',
                        }}>
                            {getStatusLabel(executionStatus)}
                        </span>
                    </div>
                )}

                {/* Output Handle */}
                <Handle
                    type="source"
                    position={Position.Bottom}
                    style={{
                        width: 10,
                        height: 10,
                        background: isActive ? accentColor : '#666',
                        border: '2px solid #1a1a1a',
                    }}
                />

                {/* CSS Animation (injected via style tag) */}
                {isActive && (
                    <style>{`
                        @keyframes workflow-node-pulse {
                            0%, 100% { box-shadow: 0 0 20px ${accentColor}60, 0 0 40px ${accentColor}30, 0 4px 12px rgba(0,0,0,0.5); }
                            50% { box-shadow: 0 0 30px ${accentColor}80, 0 0 60px ${accentColor}40, 0 4px 16px rgba(0,0,0,0.6); }
                        }
                        @keyframes spin {
                            from { transform: rotate(0deg); }
                            to { transform: rotate(360deg); }
                        }
                    `}</style>
                )}
            </div>
        </div>
    );
}


