import { Button } from "@/ui/components/button.tsx";

export default function App() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center space-y-4">
      <h1 className="text-4xl font-bold">ReelLife</h1>
      <p className="text-muted-foreground">Main Life Screen — scaffold.</p>
      <Button onClick={() => console.log("engine not yet wired")}>Initialize Engine</Button>
    </div>
  );
}

