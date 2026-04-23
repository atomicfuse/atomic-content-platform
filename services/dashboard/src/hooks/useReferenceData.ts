"use client";

import { useState, useEffect } from "react";
import {
  getAudiences,
  getVerticals,
  getCategories,
  getTags,
  type ReferenceItem,
  type VerticalItem,
  type CategoryItem,
  type TagItem,
} from "@/lib/reference-data";

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

export function useVerticals(): { verticals: VerticalItem[]; loading: boolean } {
  const [verticals, setVerticals] = useState<VerticalItem[]>([]);
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

export function useCategories(verticalId: string): { categories: CategoryItem[]; loading: boolean } {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!verticalId) {
      setCategories([]);
      return;
    }
    setLoading(true);
    getCategories(verticalId)
      .then(setCategories)
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, [verticalId]);

  return { categories, loading };
}

export function useTags(verticalId: string): { tags: TagItem[]; loading: boolean; refetch: () => void } {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!verticalId) {
      setTags([]);
      return;
    }
    setLoading(true);
    getTags(verticalId)
      .then(setTags)
      .catch(() => setTags([]))
      .finally(() => setLoading(false));
  }, [verticalId, tick]);

  function refetch(): void {
    setTick((t) => t + 1);
  }

  return { tags, loading, refetch };
}
