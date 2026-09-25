import { Badge } from "@/ui/components/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

export interface KnowledgeBadgeProps {
  readonly state: "known" | "estimate" | "rumor" | "inference" | "unknown" | "hidden";
}

export function KnowledgeBadge({ state }: KnowledgeBadgeProps) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    known: "default",
    estimate: "secondary",
    rumor: "destructive",
    inference: "outline",
    unknown: "secondary",
    hidden: "outline",
  };

  return (
    <Badge variant={variants[state] ?? "outline"} className="text-xs uppercase tracking-wider">
      {state}
    </Badge>
  );
}

export interface CharacterViewProps {
  readonly name: string;
  readonly age: number;
  readonly lifeStage: string;
  readonly temperament: string;
  readonly traits: readonly { readonly name: string; readonly value: number }[];
  readonly beliefs: readonly {
    readonly subject: string;
    readonly statement: string;
    readonly knowledgeState: "known" | "estimate" | "rumor" | "inference" | "unknown" | "hidden";
  }[];
}

export function CharacterView({
  name,
  age,
  lifeStage,
  temperament,
  traits,
  beliefs,
}: CharacterViewProps) {
  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-2xl">{name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Age: {Math.floor(age)} • Stage: <span className="capitalize">{lifeStage}</span> • Temperament: <span className="capitalize">{temperament}</span>
              </p>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Traits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Personality Dimensions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {traits.map((t) => (
              <div key={t.name} className="flex justify-between text-sm">
                <span className="capitalize text-muted-foreground">{t.name}</span>
                <span className="font-mono font-medium">{t.value.toFixed(2)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Beliefs with distinct KnowledgeState badges */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Beliefs & Perceptions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {beliefs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No beliefs formed yet.</p>
            ) : (
              beliefs.map((b, i) => (
                <div key={i} className="p-2 border rounded-md flex justify-between items-center text-sm">
                  <div>
                    <p className="font-medium">{b.subject}</p>
                    <p className="text-xs text-muted-foreground">{b.statement}</p>
                  </div>
                  <KnowledgeBadge state={b.knowledgeState} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
