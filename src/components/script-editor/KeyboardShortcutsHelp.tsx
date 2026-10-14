import i18n from "@/lib/i18n.ts";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatShortcut } from "@/lib/platform.ts";

const SHORTCUTS = [
  { keys: "A", action: "common:customUi.selectAllNodes" },
  { keys: "Alt + A", action: "common:customUi.deselectAll" },
  { keys: "Shift + A", action: "common:customUi.quickAddMenu" },
  { keys: "Shift + D", action: "common:customUi.duplicateSelection" },
  { keys: "L", action: "common:customUi.selectLinkedNodes" },
  { keys: "Ctrl + L", action: "common:customUi.selectUpstreamNodes" },
  { keys: "Alt + L", action: "common:customUi.selectDownstreamNodes" },
  { keys: "Shift + S", action: "common:customUi.selectSimilarNodes" },
  { keys: "Tab", action: "common:customUi.enterExitGroup" },
  { keys: "M", action: "common:customUi.toggleMuteNode" },
  { keys: "H", action: "common:customUi.toggleCollapseNode" },
  { keys: "Ctrl + H", action: "common:customUi.hideUnconnectedSockets" },
  { keys: "Shift + H", action: "common:customUi.toggleNodePreview" },
  { keys: "Ctrl + G", action: "common:customUi.createGroupFromSelection" },
  { keys: "Ctrl + Alt + G", action: "common:customUi.ungroupSelected" },
  { keys: "Ctrl + J", action: "common:customUi.createFrameFromSelection" },
  { keys: "Ctrl + C", action: "common:customUi.copySelection" },
  { keys: "Ctrl + V", action: "common:customUi.paste" },
  { keys: "Ctrl + Shift + ←↑↓→", action: "common:customUi.alignNodes" },
  { keys: "Alt + Shift + H/V", action: "common:customUi.distributeNodes" },
  { keys: "Alt + Drag", action: "common:customUi.cutLinks" },
  { keys: "Shift + Right Click", action: "common:customUi.quickRerouteOnEdge" },
  { keys: "Right Click", action: "common:customUi.quickAddMenuAtCursor" },
  { keys: "Delete / Backspace / X", action: "common:customUi.deleteSelection" },
  { keys: "F2", action: "common:customUi.renameSelectedNode" },
];

/**
 * A help button that shows available keyboard shortcuts.
 * Blender-style: Users can quickly reference shortcuts while learning.
 */
export function KeyboardShortcutsHelp() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="outline" size="icon" className="h-8 w-8" />}
        >
          <Keyboard className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent side="left" className="w-64">
          <div className="flex flex-col gap-2">
            <p className="font-medium">
              {i18n.t("common:customUi.keyboardShortcuts")}
            </p>
            <div className="flex flex-col gap-1">
              {SHORTCUTS.map(({ keys, action }) => (
                <div
                  key={keys}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-muted-foreground">
                    {i18n.t(action)}
                  </span>
                  <Kbd className="font-mono">{formatShortcut(keys)}</Kbd>
                </div>
              ))}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
