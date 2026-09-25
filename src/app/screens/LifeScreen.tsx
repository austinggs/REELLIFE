import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";

export interface LifeScreenProps {
  readonly personName: string;
  readonly dateLabel: string;
  readonly dayPhase: string;
  readonly location: string;
  readonly currentActivity: string;
  readonly hunger: number;
  readonly energy: number;
  readonly hygiene: number;
  readonly mood: string;
  readonly onAction: (actionType: string) => void;
}

export function LifeScreen({
  personName,
  dateLabel,
  dayPhase,
  location,
  currentActivity,
  hunger,
  energy,
  hygiene,
  mood,
  onAction,
}: LifeScreenProps) {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4">
      {/* Top Banner / Situation Bar */}
      <Card className="bg-card border shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-bold">{personName}</CardTitle>
            <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
              <span>{dateLabel}</span>
              <span>•</span>
              <Badge variant="outline" className="capitalize">{dayPhase}</Badge>
              <span>•</span>
              <span>{location}</span>
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground uppercase tracking-wider block">Mood</span>
            <Badge variant="secondary" className="text-sm capitalize mt-1">{mood}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 p-3 rounded-md flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current Activity:</span>
            <span className="font-medium">{currentActivity}</span>
          </div>
        </CardContent>
      </Card>

      {/* Needs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between text-sm mb-2 font-medium">
              <span>Hunger</span>
              <span>{Math.round(hunger * 100)}%</span>
            </div>
            <Progress value={hunger * 100} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between text-sm mb-2 font-medium">
              <span>Energy</span>
              <span>{Math.round(energy * 100)}%</span>
            </div>
            <Progress value={energy * 100} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between text-sm mb-2 font-medium">
              <span>Hygiene</span>
              <span>{Math.round(hygiene * 100)}%</span>
            </div>
            <Progress value={hygiene * 100} />
          </CardContent>
        </Card>
      </div>

      {/* Action Surface (Intent -> Commit step) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {["Eat Meal", "Sleep", "Shower", "Socialize", "Work Shift"].map((act) => (
              <Button
                key={act}
                variant={selectedAction === act ? "default" : "outline"}
                onClick={() => setSelectedAction(act)}
              >
                {act}
              </Button>
            ))}
          </div>

          {selectedAction && (
            <div className="p-4 border rounded-md bg-accent/20 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Commit to action: {selectedAction}</p>
                <p className="text-xs text-muted-foreground">Estimated time: ~1 hour</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedAction(null)}>Cancel</Button>
                <Button size="sm" onClick={() => { onAction(selectedAction); setSelectedAction(null); }}>
                  Confirm
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
