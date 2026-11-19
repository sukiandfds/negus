export function MessageSelectionBar({ selectedCount, onForward, onCancel }: {
  selectedCount: number;
  onForward: () => void;
  onCancel: () => void;
}) {
  return <div className="message-selection-bar">
    <button type="button" disabled={!selectedCount} onClick={onForward}>转发消息 ({selectedCount})</button>
    <button type="button" onClick={onCancel}>取消</button>
  </div>;
}
