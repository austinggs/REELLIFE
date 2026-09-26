import { useState } from "react";
import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import { knowledgeLabel, knowledgeTone } from "@/app/ui/knowledge.ts";
import type { SearchResultView } from "@/engine/query/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";
import { Input } from "@/ui/components/input.tsx";

export interface SearchScreenProps {
  readonly density: UiDensity;
  /** Runs the search through the query layer, never against raw state. */
  readonly onSearch: (query: string) => readonly SearchResultView[];
  readonly onOpenPerson: (personId: string) => void;
  readonly canInspect: boolean;
  readonly onInspect: (id: string) => void;
}

/**
 * Search screen (UI/UX 03 section 6, UI/UX 18).
 *
 * Search is over what the viewer is *entitled* to know: themselves, the people
 * they live with or know, their own household, the places they can locate, and
 * events they may see. It is deliberately not a global index — a search that
 * revealed strangers would be a second source of truth.
 */
export function SearchScreen({
  density,
  onSearch,
  onOpenPerson,
  canInspect,
  onInspect,
}: SearchScreenProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly SearchResultView[] | null>(null);

  return (
    <div className={`${densityClasses(density)} mx-auto max-w-3xl p-4`}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Search what you know</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setResults(onSearch(query));
            }}
          >
            <Input
              aria-label="Search people, places, households and events you know"
              placeholder="A name, a place, an event…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit">Search</Button>
          </form>
          {results === null ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Only people, places and events you have a way of knowing about can be found.
            </p>
          ) : results.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing you know of matches “{query}”.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {results.map((result) => (
                <li
                  key={`${result.kind}-${result.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {result.kind}
                    </Badge>
                    <span className="font-medium">{result.label}</span>
                    <Badge
                      variant={knowledgeTone(result.knowledge)}
                      className="text-[10px] uppercase"
                    >
                      {knowledgeLabel(result.knowledge)}
                    </Badge>
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {result.detail}
                    {result.kind === "person" ? (
                      <Button size="sm" variant="ghost" onClick={() => onOpenPerson(result.id)}>
                        Open
                      </Button>
                    ) : canInspect ? (
                      <Button size="sm" variant="ghost" onClick={() => onInspect(result.id)}>
                        Inspect
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
