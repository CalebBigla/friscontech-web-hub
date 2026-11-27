import { useEffect, useState } from "react";
import { ArrowLeft, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, FieldError, FilterSelect, SearchBox } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Db } from "@/data/mock-db";
import { useConvertToPromo } from "@/hooks/use-inventory";
import { formatNumber } from "@/lib/format";
import { getAvailableStock } from "@/lib/inventory-calculations";
import type { AccessScope } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/supabase-helpers";

/**
 * Owner (any branch) or a manager (own branch): pick goods and move units of them
 * into promo stock. Each product's units go to its promo twin ("<name> (Promo)", ₦0),
 * which reps can then put on a customer order while some are available.
 */
export function ConvertToPromoDialog({ open, onOpenChange, db, scope }: {
  open: boolean; onOpenChange: (o: boolean) => void; db: Db; scope: AccessScope;
}) {
  const convert = useConvertToPromo();
  const branches = db.branches.filter((b) => b.status === "active" && (!scope.branchIds || scope.branchIds.includes(b.id)));
  const [branchId, setBranchId] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [errors, setErrors] = useState<{ items?: string | undefined; reason?: string | undefined; form?: string | undefined; rows?: Record<string, string> }>({});

  useEffect(() => {
    if (!open) return;
    setBranchId(scope.branchIds ? (scope.user.branchId ?? "") : (branches[0]?.id ?? ""));
    setPicked({});
    setQuery("");
    setReason("");
    setReviewing(false);
    setErrors({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const branch = db.branches.find((b) => b.id === branchId);
  const available = (productId: string) => getAvailableStock(db, productId, branchId);
  const needle = query.trim().toLowerCase();
  const products = db.products
    .filter((p) => p.status === "active" && p.productType !== "promo" && available(p.id) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = products.filter((p) => !needle || `${p.name} ${p.sku}`.toLowerCase().includes(needle));
  const chosen = products.filter((p) => picked[p.id] !== undefined);
  const qty = (id: string) => Number(picked[id]);
  const units = chosen.reduce((sum, p) => sum + (qty(p.id) > 0 ? qty(p.id) : 0), 0);

  function toggle(id: string, on: boolean) {
    setPicked((all) => {
      const next = { ...all };
      if (on) next[id] = "1"; else delete next[id];
      return next;
    });
  }

  function check() {
    const next: typeof errors = { rows: {} };
    if (!chosen.length) next.items = "Choose at least one product";
    for (const p of chosen) {
      const q = qty(p.id);
      const left = available(p.id);
      if (!Number.isInteger(q) || q <= 0) next.rows![p.id] = "Enter a whole quantity above zero";
      else if (q > left) next.rows![p.id] = `Only ${formatNumber(left)} available`;
    }
    if (!reason.trim()) next.reason = "Say why this stock becomes promo";
    setErrors(next);
    return !next.items && !next.reason && !Object.keys(next.rows!).length;
  }

  async function submit() {
    if (!reviewing) {
      if (check()) setReviewing(true);
      return;
    }
    try {
      await convert.mutateAsync({
        p_branch_id: branchId,
        p_items: chosen.map((p) => ({ product_id: p.id, quantity: qty(p.id) })),
        p_reason: reason.trim(),
      });
      toast.success(`${formatNumber(units)} unit${units === 1 ? "" : "s"} moved to promo`, {
        description: `${branch?.name ?? "Branch"} · reps can now add them to customer orders at no charge.`,
      });
      onOpenChange(false);
    } catch (failure) {
      const fields = fieldErrorsFrom(failure, ["items", "reason", "quantity", "branchId"] as const);
      setReviewing(false);
      setErrors({ reason: fields.reason, form: fields.items ?? fields.quantity ?? fields.branchId ?? fields.form ?? "Could not move the stock to promo" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{reviewing ? "Check the promo stock" : "Move stock to promo"}</DialogTitle>
          <DialogDescription className="text-xs">
            {reviewing
              ? "Nothing changes until you confirm. The units leave the product's stock and become free promo items."
              : "Choose goods and how many units become promo. Their price becomes ₦0, and reps can add them to customer orders while they are available."}
          </DialogDescription>
        </DialogHeader>

        {reviewing ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3 text-xs">
              <p className="text-muted-foreground">Branch</p>
              <p className="mt-0.5 font-semibold">{branch?.name}</p>
            </div>
            <ul className="divide-y divide-border rounded-md border border-border text-xs">
              {chosen.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{p.name} → <strong>{p.name} (Promo)</strong></span>
                  <span className="font-semibold tabular-nums">{formatNumber(qty(p.id))} {p.unit}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Reason: {reason.trim()}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {!scope.branchIds ? (
              <div>
                <Label className="text-xs">Branch *</Label>
                <div className="mt-1.5">
                  <FilterSelect label="Branch" className="w-full" value={branchId || "none"}
                    onChange={(v) => { setBranchId(v === "none" ? "" : v); setPicked({}); }}
                    options={branches.length ? branches.map((b) => ({ value: b.id, label: b.name })) : [{ value: "none", label: "No active branches" }]} />
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-border px-3 py-2 text-xs"><span className="text-muted-foreground">Branch · </span><strong>{branch?.name ?? "Your branch"}</strong></p>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Goods *</Label>
                <SearchBox value={query} onChange={setQuery} placeholder="Search product or SKU" className="w-48" />
              </div>
              {shown.length ? (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {shown.map((p) => {
                    const on = picked[p.id] !== undefined;
                    return (
                      <li key={p.id} className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <Checkbox id={`promo-${p.id}`} checked={on} onCheckedChange={(v) => toggle(p.id, v === true)} />
                          <label htmlFor={`promo-${p.id}`} className="min-w-0 flex-1 cursor-pointer text-xs">
                            <span className="block truncate font-semibold">{p.name}</span>
                            <span className="text-[11px] text-muted-foreground">{p.sku} · {formatNumber(available(p.id))} available</span>
                          </label>
                          {on && (
                            <Input aria-label={`Units of ${p.name} to move to promo`} type="number" inputMode="numeric" min={1} step={1}
                              max={available(p.id)} value={picked[p.id]} onChange={(e) => setPicked((all) => ({ ...all, [p.id]: e.target.value }))}
                              className="h-8 w-24 text-right" aria-invalid={!!errors.rows?.[p.id]} />
                          )}
                        </div>
                        <FieldError message={errors.rows?.[p.id]} />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState icon={Gift} title={products.length ? "No goods match" : "No goods available"}
                  detail={products.length ? "Try a different search." : "This branch has no regular stock available to move."} />
              )}
              <FieldError message={errors.items} />
            </div>
            <div>
              <Label htmlFor="promo-reason" className="text-xs">Reason *</Label>
              <Textarea id="promo-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5"
                placeholder="e.g. December giveaway, near-expiry stock" />
              <FieldError message={errors.reason} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-md bg-muted p-3">
          <span className="text-xs text-muted-foreground">{chosen.length} product{chosen.length === 1 ? "" : "s"} to promo</span>
          <strong className="tabular-nums">{formatNumber(units)} units</strong>
        </div>
        <FieldError message={errors.form} />
        <DialogFooter className="gap-2">
          {reviewing ? (
            <Button type="button" variant="outline" onClick={() => setReviewing(false)}><ArrowLeft className="size-4" />Back</Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          <Button type="button" disabled={convert.isPending || !branchId} onClick={() => void submit()}>
            {convert.isPending ? <Loader2 className="size-4 animate-spin" /> : reviewing ? <Gift className="size-4" /> : null}
            {reviewing ? "Move to promo" : "Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
