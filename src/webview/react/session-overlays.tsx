import { ReferenceIcon } from './reference-labels';
import { useContext, useLayoutEffect, useRef } from 'react';
import { UiContext, useUi } from './session-context';
export function Hover({ id }: { id: string }) {
  const model = useUi((state) => state.hovers[id]);
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (model) model.onMount?.(element.current);
  }, [model]);
  return (
    <div
      ref={element}
      id={id}
      hidden={!model}
      role="tooltip"
      className={
        id === 'toolbar-tooltip'
          ? 'toolbar-tooltip'
          : `commit-hover ${model?.kind === 'message' ? 'message-hover' : 'refs-hover'}${model?.kind === 'jump' ? ' jump-hover' : ''}${model?.references ? ' reference-popup' : ''}`
      }
    >
      {model?.references ? (
        <>
          {model.references.slice(0, 10).map((ref, index) => (
            <div className="reference-popup-row" key={index}>
              <ReferenceIcon refs={[ref]} />
              <span>{ref.name}</span>
              <button
                className="hover-copy"
                aria-label={`Copy ${ref.name}`}
                title="Copy reference name"
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  model.copy?.(ref.name);
                }}
              >
                <span className="copy-action-icon" />
              </button>
            </div>
          ))}
          {model.references.length > 10 && (
            <div className="reference-more">{model.references.length - 10} more references</div>
          )}
        </>
      ) : model?.kind === 'refs' ? (
        model.names.map((name, index) => (
          <small key={`${index}:${name}`} className="refs">
            {name}
            <button
              className="hover-copy"
              title="Copy branch name"
              aria-label={`Copy ${name}`}
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                model.copy?.(name);
              }}
            >
              <span className="copy-action-icon" />
            </button>
          </small>
        ))
      ) : (
        <span
          className={
            model?.kind === 'jump'
              ? 'refs'
              : model?.kind === 'message'
                ? 'hover-message'
                : undefined
          }
        >
          {model?.text}
        </span>
      )}
    </div>
  );
}
export function RefDialog() {
  const model = useUi((state) => state.refDialog);
  const { store, env } = useContext(UiContext);
  const dialog = useRef<HTMLDialogElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const option = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!model) return;
    dialog.current.showModal();
    name.current.focus();
  }, [model?.id]);
  const close = () => {
    store.setState({ refDialog: null });
    model?.onClose?.();
    env.document
      .querySelector<HTMLElement>('.commit[aria-selected="true"]')
      ?.focus({ preventScroll: true });
  };
  if (!model) return null;
  return (
    <dialog
      id="commit-ref-dialog"
      className="commit-ref-dialog"
      ref={dialog}
      data-request={model.id}
      aria-labelledby="commit-ref-title"
      onClose={close}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!event.currentTarget.reportValidity()) return;
          store.setState({ refDialog: { ...model, busy: true } });
          model.onSubmit({
            name: name.current.value,
            checkout: option.current?.checked === true,
            dialogId: model.id,
          });
        }}
      >
        <h2 id="commit-ref-title">{model.kind === 'branch' ? 'New Branch' : 'New Tag'}</h2>
        <p title={model.hash}>Revision: {model.hash.slice(0, 8)}</p>
        <label htmlFor="commit-ref-name">
          {model.kind === 'branch' ? 'Branch name:' : 'Tag name:'}
        </label>
        <input ref={name} id="commit-ref-name" required autoComplete="off" />
        {model.kind === 'branch' && (
          <label className="commit-ref-option">
            <input ref={option} type="checkbox" defaultChecked />
            Checkout branch
          </label>
        )}
        <div className="commit-ref-actions">
          <button type="button" onClick={() => dialog.current.close()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={model.busy}>
            Create
          </button>
        </div>
      </form>
    </dialog>
  );
}
