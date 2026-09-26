"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { CompareView } from "@/components/compare";
import { Card, CardBody, Field, Loading, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useVersions } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { humanize } from "@/lib/utils";

export default function VersionComparePage() {
  const { id } = useParams<{ id: string }>();
  const version = useQuery({ queryKey: ["version", id], queryFn: () => api(S.VersionDetail, "GET", `/resume/${id}`) });
  const versions = useVersions();
  const [other, setOther] = useState<string | null>(null);

  if (version.isLoading || versions.isLoading) return <Loading />;
  const v = version.data;
  const list = (versions.data?.versions ?? []).filter((x) => x.id !== id);
  const master = list.find((x) => x.version_type === "MASTER");
  const against = other ?? v?.parent_version_id ?? master?.id ?? list[0]?.id ?? "";

  return (
    <>
      <Link href={`/resume-lab/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Version {v?.version_number}
      </Link>
      <PageHeader title="Compare" description="Measurable document differences only. These numbers don’t predict which version will get more interviews." />
      <Card className="mb-5">
        <CardBody>
          <Field label={`Compare v${v?.version_number} against`}>
            <Select value={against} onChange={(e) => setOther(e.target.value)}>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  v{x.version_number} · {x.label ?? humanize(x.version_type)}
                  {x.id === v?.parent_version_id ? " (parent)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>
      {against ? <CompareView key={against} ids={[against, id]} /> : <p className="text-sm text-muted-foreground">There is no other version to compare with.</p>}
    </>
  );
}
