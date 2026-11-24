import { useLayoutEffect, useRef, useState } from 'react';
import { useUiContext, useUi, useRule } from './session-context';
import type { ActionMenuItem } from './session-types';
import { Icon } from './log-chrome';
export function Menu({ id }: { id: string }) {
  const model = useUi((state) => state.menus[id]);
  const { env, ui } = useUiContext();
  const menu = useRef<HTMLDivElement>(null);
  const style = useRule(`#${id}`);
  const [submenu, setSubmenu] = useState<{
    item: ActionMenuItem;
    anchor: HTMLElement;
    focus?: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    if (!model) {
      setSubmenu(null);
      return;
    }
    const element = menu.current,
      anchor = model.anchor?.getBoundingClientRect();
    if (!element) return;
    const width = env.window.innerWidth,
      height = env.window.innerHeight;
    style.left = `${Math.max(0, Math.min(model.point?.x ?? (anchor ? (id === 'view-menu' ? anchor.right - element.offsetWidth : anchor.left) : 0), width - element.offsetWidth - 8))}px`;
    const top =
      model.point?.y ??
      (anchor
        ? anchor.bottom + element.offsetHeight + 4 <= height
          ? anchor.bottom + 4
          : anchor.top - element.offsetHeight - 4
        : 0);
    style.top = `${Math.max(0, Math.min(top, height - element.offsetHeight - 8))}px`;
    if (!element.contains(env.document.activeElement))
      element.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [model, env, id, style]);
  const keyboard = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      ui.closeMenu(id, true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(':scope > button:not(:disabled)'),
    ];
    const index = buttons.indexOf(env.document.activeElement as HTMLElement);
    buttons[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    ]?.focus();
  };
  return (
    <div
      id={id}
      ref={menu}
      role="menu"
      hidden={!model}
      aria-label={model?.label}
      onKeyDown={keyboard}
    >
      {model?.heading && <div className="commit-menu-heading">{model.heading}</div>}
      {model?.items.map((item, index) => (
        <MenuItem
          key={`${index}:${item.label ?? item.heading ?? 'separator'}`}
          item={item}
          variant={model.variant ?? (id === 'branch-menu' ? 'context' : 'view')}
          onSubmenu={(anchor, focus) => setSubmenu({ item, anchor, focus })}
          onAction={() => {
            if (!item.keepOpen) ui.closeMenu(id);
            item.action?.();
          }}
        />
      ))}
      {submenu && menu.current && (
        <Submenu
          model={{
            ...submenu,
            item: model?.items.find((item) => item.label === submenu.item.label) ?? submenu.item,
          }}
          parent={menu.current}
          onClose={() => setSubmenu(null)}
          onSelect={(item) => {
            if (!item.keepOpen) ui.closeMenu(id);
            item.action?.();
          }}
        />
      )}
    </div>
  );
}
function MenuItem({
  item,
  variant,
  onAction,
  onSubmenu,
}: {
  item: ActionMenuItem;
  variant: 'context' | 'view';
  onAction(): void;
  onSubmenu(anchor: HTMLElement, focus?: boolean): void;
}) {
  if (item.separator) return <hr role="separator" />;
  if (item.heading) return <div className="view-menu-heading">{item.heading}</div>;
  return (
    <button
      className={variant === 'view' ? 'view-menu-item' : undefined}
      role={item.role ?? 'menuitem'}
      disabled={item.disabled}
      aria-checked={item.checked}
      aria-haspopup={item.children ? 'menu' : undefined}
      title={item.title}
      onClick={(event) => (item.children ? onSubmenu(event.currentTarget, true) : onAction())}
      onPointerEnter={(event) => {
        if (item.children) onSubmenu(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (item.children && event.key === 'ArrowRight') {
          event.preventDefault();
          onSubmenu(event.currentTarget, true);
        }
      }}
    >
      {variant === 'view' ? (
        <span className="menu-check">{item.checked ? '✓' : ''}</span>
      ) : item.icon ? (
        <Icon name={item.icon} />
      ) : (
        <span className="branch-menu-icon" />
      )}
      <span className={variant === 'context' ? 'branch-menu-label' : undefined}>{item.label}</span>
      {item.shortcut && <span className="branch-menu-shortcut">{item.shortcut}</span>}
      {item.children && <Icon name="right" />}
    </button>
  );
}
function Submenu({
  model,
  parent,
  onClose,
  onSelect,
}: {
  model: { item: ActionMenuItem; anchor: HTMLElement; focus?: boolean };
  parent: HTMLElement;
  onClose(): void;
  onSelect(item: ActionMenuItem): void;
}) {
  const { env } = useUiContext();
  const ref = useRef<HTMLDivElement>(null);
  const style = useRule('.session-submenu');
  useLayoutEffect(() => {
    const r = parent.getBoundingClientRect(),
      b = model.anchor.getBoundingClientRect(),
      node = ref.current;
    if (!node) return;
    style.left = `${Math.max(0, r.right + node.offsetWidth < env.window.innerWidth ? r.right : r.left - node.offsetWidth)}px`;
    style.top = `${Math.max(0, Math.min(b.top, env.window.innerHeight - node.offsetHeight - 8))}px`;
    if (model.focus && !node.contains(env.document.activeElement))
      node.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [model, env, parent, style]);
  return (
    <div
      ref={ref}
      className="columns-menu session-submenu"
      role="menu"
      aria-label={model.item.label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          model.anchor.focus();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'),
          ];
          const index = buttons.indexOf(env.document.activeElement as HTMLElement);
          buttons[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          ]?.focus();
        }
      }}
    >
      {model.item.children?.map((item, index) => (
        <MenuItem
          key={index}
          item={item}
          variant="view"
          onSubmenu={() => {}}
          onAction={() => onSelect(item)}
        />
      ))}
    </div>
  );
}
