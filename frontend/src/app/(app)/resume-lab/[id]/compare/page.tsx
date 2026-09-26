"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";

import { CompareView } from "@/components/resume/compare";
import { Card, CardBody, Field, PageHeader, PageSkeleton, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useVersions } from "@/lib/hooks";
import * as S from "@/lib/schemas";

export default function VersionComparePage() {
  const { id } = useParams<{ id: string }>();
  const version = useQuery({ queryKey: ["version", id], queryFn: () => api(S.VersionDetail, "GET", `/resume/${id}`) });
  const versions = useVersions();
  const [other, setOther] = useState<string | null>(null);

  if (version.isLoading || versions.isLoading) return <PageSkeleton />;
  const v = version.data;
  const list = (versions.data?.versions ?? []).filter((x) => x.id !== id);
  const base = list.find((x) => x.version_type === "MASTER");
  const against = other ?? v?.parent_version_id ?? base?.id ?? list[0]?.id ?? "";
  const name = (x: { version_type: string; label?: string | null; version_number: number }) => (x.version_type === "MASTER" ? `Base resume (v${x.version_number})` : x.label ?? `Version ${x.version_number}`);

  return (
    <>
      <PageHeader back={{ href: `/resume-lab/${id}`, label: v ? name(v) : "Version" }} title="Compare" description="Measurable document differences only. These numbers don’t predict which version will get more interviews." />
      <Card className="mb-5">
        <CardBody className="pt-5">
          <Field label={`Compare ${v ? name(v) : "this version"} with`} htmlFor="cmp-other">
            <Select id="cmp-other" value={against} onChange={(e) => setOther(e.target.value)}>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {name(x)}
                  {x.id === v?.parent_version_id ? " — parent" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>
      {against ? <CompareView key={against} ids={[against, id]} /> : <p className="text-sm text-muted">There’s no other version to compare with.</p>}
    </>
  );
}
