/**
 * The layers tree.
 *
 * Deep structure is the point of a real builder, and structure you cannot see is
 * structure you cannot fix. The tree is also a second drag source into the same
 * drop engine the canvas uses, which matters for the cases direct manipulation is
 * bad at — moving something into a collapsed or zero-height container, or
 * reordering two elements that are visually far apart.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { beginDragFromChrome } from '../../canvas/dragSource';
import { Icon, IconButton } from '../common';
import { useEditor } from '../../store/editor';
import { nodeLabel } from '../../core/factory';
import { getComponent } from '../../registry/registry';
import { ancestorsOf } from '../../core/tree';
import type { SBNode } from '../../core/types';

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const selectedId = useEditor((s) => s.selectedId);
  const hoverId = useEditor((s) => s.hoverId);
  const select = useEditor((s) => s.select);
  const setHover = useEditor((s) => s.setHover);
  const toggleFlag = useEditor((s) => s.toggleFlag);

  const page = doc.pages.find((candidate) => candidate.id === currentPageId) ?? doc.pages[0];
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Reveal the selection: selecting on the canvas should never leave the tree
  // showing a collapsed branch that hides where you are.
  useEffect(() => {
    if (!selectedId) return;
    const trail = ancestorsOf(doc.nodes, selectedId);
    setCollapsed((previous) => {
      if (!trail.some((id) => previous.has(id))) return previous;
      const next = new Set(previous);
      for (const id of trail) next.delete(id);
      return next;
    });
  }, [selectedId, doc.nodes]);

  const rows = useMemo(() => {
    const out: { node: SBNode; depth: number }[] = [];
    const visit = (id: string, depth: number) => {
      const node = doc.nodes[id];
      if (!node) return;
      out.push({ node, depth });
      if (collapsed.has(id)) return;
      for (const childId of node.children) visit(childId, depth + 1);
    };
    visit(page.rootId, 0);
    return out;
  }, [doc.nodes, page.rootId, collapsed]);

  return (
    <div className="ui-panel">
      <header className="ui-panel__head">
        <h2>Layers</h2>
        <span className="ui-panel__sub">{page.name}</span>
      </header>

      <div className="ui-panel__scroll ui-tree" onPointerLeave={() => setHover(null)}>
        {rows.map(({ node, depth }) => {
          const def = getComponent(node.type);
          const isRoot = node.parent === null;
          const hasChildren = node.children.length > 0;
          return (
            <div
              key={node.id}
              className={`ui-tree__row ${selectedId === node.id ? 'is-selected' : ''} ${
                hoverId === node.id ? 'is-hover' : ''
              } ${node.hidden ? 'is-hidden' : ''}`}
              style={{ paddingLeft: `${8 + depth * 13}px` }}
              onPointerEnter={() => setHover(node.id)}
            >
              <button
                type="button"
                className="ui-tree__twist"
                onClick={() => hasChildren && toggle(node.id)}
                aria-label={collapsed.has(node.id) ? 'Expand' : 'Collapse'}
                aria-expanded={hasChildren ? !collapsed.has(node.id) : undefined}
                style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
              >
                <Icon
                  path="M9 6l6 6-6 6"
                  size={11}
                  strokeWidth={2.2}
                />
              </button>

              <button
                type="button"
                className="ui-tree__label"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  select(node.id);
                  // Page roots cannot move, so they get selection only.
                  if (!isRoot) {
                    beginDragFromChrome({ kind: 'move', nodeId: node.id }, event);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select(node.id);
                  }
                }}
                title={def?.label ?? node.type}
              >
                <Icon path={def?.icon ?? 'M4 4h16v16H4z'} size={13} />
                <span>{nodeLabel(doc, node)}</span>
              </button>

              {isRoot ? null : (
                <span className="ui-tree__actions">
                  <IconButton
                    icon={
                      node.locked
                        ? 'M6 11h12v10H6zM9 11V8a3 3 0 0 1 6 0v3'
                        : 'M6 11h12v10H6zM9 11V8a3 3 0 0 1 5.9-.7'
                    }
                    label={node.locked ? 'Unlock' : 'Lock'}
                    size={13}
                    active={node.locked}
                    onClick={() => toggleFlag(node.id, 'locked')}
                  />
                  <IconButton
                    icon={
                      node.hidden
                        ? 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M6.7 6.7C4.6 8 3 10 2 12c2 4 6 7 10 7 1.6 0 3.1-.4 4.4-1.1M17.9 14.6C19.3 13.7 20.4 12.5 22 12c-2-4-6-7-10-7-.7 0-1.4.1-2 .3'
                        : 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
                    }
                    label={node.hidden ? 'Show' : 'Hide'}
                    size={13}
                    active={node.hidden}
                    onClick={() => toggleFlag(node.id, 'hidden')}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
