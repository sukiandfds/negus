// Protocol values accepted consistently by configuration and ordinary conversation routes.
export const isReasoningEffort = value => typeof value === 'string' && ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value);
