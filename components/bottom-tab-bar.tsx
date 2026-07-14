import { TabId } from "@/types/carrymate";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "홈", icon: <HomeIcon /> },
  { id: "tasks", label: "업무", icon: <CheckIcon /> },
  { id: "schedule", label: "일정", icon: <CalendarIcon /> },
  { id: "files", label: "파일", icon: <FolderIcon /> },
];

export function BottomTabBar({ activeTab, onChange }: { activeTab: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav aria-label="주요 메뉴" 
    className="neu-bottom-nav fixed top-48 left-1/2 z-50 w-[min(calc(100%-2rem),46rem)] -translate-x-1/2 rounded-[26px] p-2.5">
      <ul className="grid grid-cols-4 gap-2">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <li key={tab.id}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onChange(tab.id)}
                className={`flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-[19px] text-[11px] font-bold transition-all duration-200 ${active ? "neu-nav-active text-[#5f54e8]" : "text-[#8f8aa3] hover:bg-white/50 hover:text-[#6259e8]"}`}
              >
                <span className="h-5 w-5">{tab.icon}</span>
                {tab.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Icon({ children }: { children: React.ReactNode }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">{children}</svg>; }
function HomeIcon(){return <Icon><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/></Icon>}
function CheckIcon(){return <Icon><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></Icon>}
function CalendarIcon(){return <Icon><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16"/></Icon>}
function FolderIcon(){return <Icon><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></Icon>}
