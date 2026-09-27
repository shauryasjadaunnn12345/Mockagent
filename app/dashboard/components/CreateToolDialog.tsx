"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTool } from "@/app/actions/tools";
import { Plus } from "lucide-react";

const DEFAULT_SCHEMA = `{
  "type": "object",
  "properties": {
    "user_id": { "type": "string" },
    "reason": { "type": "string" }
  },
  "required": ["user_id"]
}`;

const DEFAULT_MOCK = `{
  "success": true,
  "message": "Refund processed."
}`;

export function CreateToolDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await createTool({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      jsonSchema: String(formData.get("jsonSchema") ?? ""),
      mockResponse: String(formData.get("mockResponse") ?? ""),
    });

    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          New Mock Tool
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a Mock Tool</DialogTitle>
          <DialogDescription>
            Define the tool your agent will call, the JSON Schema its arguments must satisfy,
            and the mock response to return on success.
          </DialogDescription>
        </DialogHeader>

        <form
          action={(formData) => startTransition(() => handleSubmit(formData))}
          className="space-y-4"
        >
          {error && (
            <p className="rounded-md bg-red-50 p-2 text-sm text-red-600">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name">Tool name</Label>
            <Input id="name" name="name" placeholder="execute_refund" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              name="description"
              placeholder="Refunds an order for a given user_id"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="jsonSchema">Expected JSON Schema</Label>
            <Textarea
              id="jsonSchema"
              name="jsonSchema"
              defaultValue={DEFAULT_SCHEMA}
              rows={6}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mockResponse">Mock response body</Label>
            <Textarea
              id="mockResponse"
              name="mockResponse"
              defaultValue={DEFAULT_MOCK}
              rows={4}
              required
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create Tool"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
