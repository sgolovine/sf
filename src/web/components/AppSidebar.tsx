import { KanbanSquare, Monitor, Moon, Plus, Sun } from "lucide-react";
import type { BoardSnapshot } from "#model/project";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/use-theme";
import type { Theme } from "@/lib/theme";

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] satisfies { value: Theme; label: string; Icon: typeof Sun }[];

type Props = {
  boards: BoardSnapshot[];
  /** Name of the Board shown in the main area, if any. */
  title: string | undefined;
  /** The Board shown in the main area, if any. */
  activeId: string | undefined;
  creating: boolean;
  onSelect: (id: string) => void;
  onNewBoard: () => void;
  onProjectSettings: () => void;
};

/** Names the current Board and lists the Project's Boards; "New Board" sits at the bottom. */
export function AppSidebar({ boards, title, activeId, creating, onSelect, onNewBoard, onProjectSettings }: Props) {
  return (
    <Sidebar>
      <SidebarHeader>
        <span className="truncate px-2 py-1 text-lg font-semibold tracking-tight">{title}</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Boards</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {boards.map((b) => (
                <SidebarMenuItem key={b.id}>
                  <SidebarMenuButton isActive={b.id === activeId} onClick={() => onSelect(b.id)}>
                    <KanbanSquare />
                    <span>{b.config.name}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{b.config.key}</SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
              {boards.length === 0 && <p className="px-2 text-sm text-muted-foreground">No Boards yet.</p>}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenuButton onClick={onProjectSettings}>Project settings</SidebarMenuButton>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={creating} onClick={onNewBoard}>
              <Plus />
              <span>New Board</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <ThemePicker />
      </SidebarFooter>
    </Sidebar>
  );
}

/** Light / Dark / System, saved in this browser; the current choice is pressed. */
function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <fieldset aria-label="Theme" className="flex items-center gap-1 px-2">
      <span className="mr-auto text-xs text-muted-foreground">Theme</span>
      {THEMES.map(({ value, label, Icon }) => (
        <Button
          key={value}
          size="icon-sm"
          variant={theme === value ? "secondary" : "ghost"}
          aria-pressed={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
        >
          <Icon />
        </Button>
      ))}
    </fieldset>
  );
}
