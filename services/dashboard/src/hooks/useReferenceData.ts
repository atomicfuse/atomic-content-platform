"use client";

import { useState, useEffect } from "react";
import { getAudiences, getVerticals, type ReferenceItem } from "@/lib/reference-data";

export function useAudiences(): { audiences: ReferenceItem[]; loading: boolean } {
  const [audiences, setAudiences] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAudiences()
      .then(setAudiences)
      .catch(() => setAudiences([]))
      .finally(() => setLoading(false));
  }, []);

  return { audiences, loading };
}

export function useVerticals(): { verticals: ReferenceItem[]; loading: boolean } {
  const [verticals, setVerticals] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getVerticals()
      .then((v) => {
        if (v.length > 0) setVerticals(v);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { verticals, loading };
}
