import React, { useState } from 'react';

interface Props {
  onSendStep: (question: string) => void;
  disabled: boolean;
  conversationId: string;
}

const CAREER_SEQUENCE = [
  'Tell me about the distributed systems and high-throughput platforms built by Alex Rivera.',
  'What specific vector database technologies were used for that project?',
  'What challenges were faced regarding tenant isolation and citation hallucination?',
  'How does that compare with his earlier work at DataPulse Analytics?',
];

export const HistoryTestingWorkflow: React.FC<Props> = ({ onSendStep, disabled, conversationId }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const handleStepClick = (index: number) => {
    setCurrentStepIndex(index);
    onSendStep(CAREER_SEQUENCE[index]);
  };

  const handleNextInSequence = () => {
    if (currentStepIndex < CAREER_SEQUENCE.length) {
      onSendStep(CAREER_SEQUENCE[currentStepIndex]);
      setCurrentStepIndex(prev => (prev + 1) % CAREER_SEQUENCE.length);
    }
  };

  return (
    <div className="history-workflow-card">
      <div className="workflow-header">
        <span className="workflow-title">Multi-Turn Follow-Up Test Sequence</span>
        <button
          type="button"
          className="btn-next-sequence"
          onClick={handleNextInSequence}
          disabled={disabled || !conversationId}
          title={!conversationId ? 'Create or start a conversation first' : 'Run next question in sequence'}
        >
          ▶ Run Step {currentStepIndex + 1} of 4
        </button>
      </div>

      <div className="sequence-steps-list">
        {CAREER_SEQUENCE.map((q, i) => (
          <div
            key={i}
            className={`sequence-step ${currentStepIndex === i ? 'step-active' : ''}`}
            onClick={() => !disabled && conversationId && handleStepClick(i)}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-text">{q}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

