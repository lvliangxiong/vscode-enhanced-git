import { useLayoutEffect, useRef, useState } from 'react';
import { branchSelection, parseValues } from '../../shared/filters';

interface FilterEditorProps {
  kind: string;
  initialValue: string;
  choices: string[];
  branches: { name: string; ref: string }[];
  apply(values: string[]): void;
  position(): void;
}
/** The freeform editor owns only draft/completion state; committed filters stay in the host. */
export function FilterEditor({
  kind,
  initialValue,
  choices,
  branches,
  apply,
  position,
}: FilterEditorProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const completion = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState({
    options: [] as string[],
    index: 0,
    start: 0,
    visible: false,
  });
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useLayoutEffect(position, [position, value, error, suggestion]);
  const choose = () => {
    const option = suggestion.options[suggestion.index];
    if (!option || !input.current) return;
    input.current.setRangeText(option, suggestion.start, input.current.selectionStart, 'end');
    setValue(input.current.value);
    setSuggestion((previous) => ({ ...previous, visible: false }));
    input.current?.focus();
  };
  const suggest = (force = false) => {
    if (kind === 'paths' || !input.current) return;
    const before = input.current.value.slice(0, input.current.selectionStart),
      prefix = before
        .split(/[|\n]/)
        .slice(-1)[0]
        .replace(/^\s*-?/, '')
        .split('..')
        .slice(-1)[0];
    const options = choices
      .filter((option) => option.toLowerCase().includes(prefix.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
    setSuggestion({
      options,
      index: 0,
      start: input.current.selectionStart - prefix.length,
      visible: Boolean(options.length && (prefix || force)),
    });
  };
  return (
    <>
      <textarea
        ref={input}
        aria-label="Filter values"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError('');
          suggest();
        }}
        onKeyDownCapture={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            try {
              const values = parseValues(event.currentTarget.value, kind);
              if (kind === 'branch') branchSelection(values, branches);
              apply(values);
            } catch (error) {
              setError(error.message);
            }
            return;
          }
          if (event.key === ' ' && event.ctrlKey) {
            event.preventDefault();
            suggest(true);
            return;
          }
          if (
            !suggestion.visible ||
            !['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Escape') {
            setSuggestion((previous) => ({ ...previous, visible: false }));
            return;
          }
          if (['Enter', 'Tab'].includes(event.key)) {
            choose();
            return;
          }
          const count = Math.min(suggestion.options.length, 100);
          const index = (suggestion.index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
          setSuggestion((previous) => ({ ...previous, index }));
          completion.current?.children[index]?.scrollIntoView({ block: 'nearest' });
        }}
      />
      <div className="filter-editor-hint">
        Select one or more values separated with {kind === 'paths' ? 'new lines' : '| or new lines'}
        , use {/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}⏎ to finish
      </div>
      <div className="popup-error" role="alert" hidden={!error}>
        {error}
      </div>
      <div
        ref={completion}
        className="filter-completion"
        role="listbox"
        hidden={!suggestion.visible}
      >
        {suggestion.options.slice(0, 100).map((option, index) => (
          <button
            key={option}
            className="filter-completion-item"
            role="option"
            aria-selected={index === suggestion.index}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!input.current) return;
              input.current.setRangeText(
                option,
                suggestion.start,
                input.current.selectionStart,
                'end',
              );
              setValue(input.current.value);
              setSuggestion((previous) => ({ ...previous, visible: false }));
              input.current?.focus();
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </>
  );
}
