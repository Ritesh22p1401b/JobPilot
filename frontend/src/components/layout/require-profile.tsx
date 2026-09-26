"use client";

import { ArrowRight, Upload } from "lucide-react";

import { ButtonLink, EmptyState, PageHeader, PageSkeleton } from "@/components/ui";
import { useMe } from "@/lib/hooks";

/** Pages that need a candidate profile show a useful empty state until a resume is uploaded (spec §57). */
export function RequireProfile({ title, children }: { title: string; children: React.ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <PageSkeleton />;
  if (me.data && !me.data.has_profile)
    return (
      <>
        <PageHeader title={title} />
        <EmptyState
          icon={<Upload className="h-5 w-5" />}
          title="No resume uploaded yet"
          action={
            <ButtonLink href="/onboarding">
              Upload resume <ArrowRight className="h-4 w-4" />
            </ButtonLink>
          }
        >
          JobPilot builds your profile from your resume, then uses it for matching, tailoring and applications.
        </EmptyState>
      </>
    );
  return <>{children}</>;
}
