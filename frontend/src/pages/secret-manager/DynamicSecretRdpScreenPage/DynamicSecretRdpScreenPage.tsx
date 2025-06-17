import { Spinner } from "@app/components/v2";
import { useUser, useWorkspace } from "@app/context";
import { useToggle } from "@app/hooks";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const DynamicSecretRdpScreenPage = () => {
  const { currentWorkspace } = useWorkspace();
  const { user } = useUser();
  const search = useSearch({
    from: "/_authenticate/_inject-org-details/_org-layout/secret-manager/$projectId/rdp-screen"
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useToggle(true);

  useEffect(() => {
    if (canvasRef.current && canvasContainerRef.current) {
      canvasRef.current.style.display = "inline";
      canvasRef.current.width = canvasContainerRef.current.clientWidth;
      canvasRef.current.height = canvasContainerRef.current.clientHeight;

      const client = window.Mstsc.client.create(canvasRef.current);
      client.connect(
        {
          dynamicSecretName: search.dynamicSecretName,
          environmentSlug: search.environment,
          secretPath: search.secretPath,
          projectSlug: currentWorkspace.slug,
          orgId: currentWorkspace.orgId,
          userId: user.id,
          width: canvasContainerRef.current.clientWidth,
          height: canvasContainerRef.current.clientHeight
        },
        () => setIsLoading.off(),
        (err) => {
          console.log(err);
          // canvasRef.current.style.display = "none";
        }
      );
    }
  }, [canvasRef.current]);

  return (
    <div ref={canvasContainerRef} className="relative h-full">
      {isLoading && (
        <div className="absolute left-0 top-0 flex h-full w-full items-center justify-center">
          <Spinner size="lg" />
        </div>
      )}
      <canvas id="myCanvas" ref={canvasRef} />
    </div>
  );
};
