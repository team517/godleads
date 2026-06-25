import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Clock } from "lucide-react";

interface Props { campaignId: string; }

const DAYS = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Madrid", "Europe/Paris", "Europe/Berlin",
  "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney",
];

export default function CampaignSchedule({ campaignId }: Props) {
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(18);
  const [timezone, setTimezone] = useState("UTC");
  const [sendDays, setSendDays] = useState<string[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("campaigns").select("send_start_hour, send_end_hour, timezone, send_days").eq("id", campaignId).single();
      if (data) {
        setStartHour(data.send_start_hour ?? 9);
        setEndHour(data.send_end_hour ?? 18);
        setTimezone(data.timezone || "UTC");
        setSendDays((data as any).send_days || ["mon", "tue", "wed", "thu", "fri"]);
      }
    };
    load();
  }, [campaignId]);

  const toggleDay = (day: string) => {
    setSaved(false);
    setSendDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const save = async () => {
    await supabase.from("campaigns").update({
      send_start_hour: startHour, send_end_hour: endHour, timezone,
      send_days: sendDays,
    } as any).eq("id", campaignId);
    setSaved(true);
    toast.success("Schedule saved");
  };

  return (
    <div className="space-y-6 max-w-md">
      <div className="space-y-3">
        <Label className="flex items-center gap-2"><Clock className="h-4 w-4" /> Sending window</Label>
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="number" min={0} max={23} value={startHour} onChange={e => { setStartHour(parseInt(e.target.value)); setSaved(false); }} className="w-20" />
          </div>
          <span className="text-muted-foreground mt-5">—</span>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="number" min={0} max={23} value={endHour} onChange={e => { setEndHour(parseInt(e.target.value)); setSaved(false); }} className="w-20" />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Label>Timezone</Label>
        <Select value={timezone} onValueChange={v => { setTimezone(v); setSaved(false); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label>Send days</Label>
        <div className="flex flex-wrap gap-3">
          {DAYS.map(d => (
            <label key={d.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={sendDays.includes(d.value)} onCheckedChange={() => toggleDay(d.value)} />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <Button onClick={save} disabled={saved} className="w-full">
        {saved ? "✓ Saved" : "Save schedule"}
      </Button>
    </div>
  );
}
