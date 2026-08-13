import { faArrowRight, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { Button } from "@app/components/v3/generic/Buttons";
import { useToggle } from "@app/hooks";

const STORAGE_KEY = "launch-banner-dismissed-pam";

type Props = {
  headline: string;
  href: string;
};

export const LaunchBanner = ({ headline, href }: Props) => {
  const [isDismissed, setIsDismissed] = useToggle(
    typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "true"
  );

  if (isDismissed) return null;

  const dismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setIsDismissed.on();
  };

  return (
    <div className="flex items-center justify-center gap-3 border-b border-mineshaft-600 bg-mineshaft-800 px-4 py-2 text-sm">
      <span className="text-mineshaft-100">{headline}</span>
      <a href={href} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline">
        Read the announcement
        <FontAwesomeIcon icon={faArrowRight} className="ml-1.5 text-xs" />
      </a>
      <Button variant="ghost" size="xs" onClick={dismiss} aria-label="Dismiss announcement">
        <FontAwesomeIcon icon={faXmark} />
      </Button>
    </div>
  );
};
