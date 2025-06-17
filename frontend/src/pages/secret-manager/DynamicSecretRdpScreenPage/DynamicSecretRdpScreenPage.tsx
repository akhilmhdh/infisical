import { useUser, useWorkspace } from "@app/context";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const DynamicSecretRdpScreenPage = () => {
  const { currentWorkspace } = useWorkspace();
  const { user } = useUser();
  const search = useSearch({
    from: "/_authenticate/_inject-org-details/_org-layout/secret-manager/$projectId/_secret-manager-layout/rdp-screen"
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

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
        function (err) {
          console.log(err);
          // canvasRef.current.style.display = "none";
        }
      );
    }
  }, [canvasRef.current]);

  return (
    <div
      className="container mx-auto max-w-7xl"
      ref={canvasContainerRef}
      style={{ height: "calc(100% - 4rem)" }}
    >
      <canvas id="myCanvas" ref={canvasRef} />
    </div>
  );
};
