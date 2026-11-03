import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import React from "react";
import {
  Brand,
  Button,
  Card,
  Stat,
  Steps,
  Toggle,
} from "../../../../../../packages/ui/src/primitives";
import { StatusBadge } from "../../../../../../packages/ui/src/status-badge";

export function DesignPreview() {
  const [checked, setChecked] = React.useState(true);
  return (
    <main className="lamp-component-preview">
      <h1>{viewCopy.designPreviewText1}</h1>
      <p>{viewCopy.designPreviewText2}</p>
      {["dark", "light"].map((theme) => (
        <section key={theme} className="ui-theme-preview lamp-preview-section" data-theme={theme}>
          <header>
            <Brand />
            <h2>
              {theme === "dark" ? viewCopy.appearanceFieldsText6 : viewCopy.appearanceFieldsText7}
            </h2>
          </header>
          <Card title={viewCopy.designPreviewText3}>
            <div className="button-row">
              <Button variant="primary">{viewCopy.finalizeTitle}</Button>
              <Button>{viewCopy.designPreviewText4}</Button>
              <Button disabled>{viewCopy.designPreviewText5}</Button>
              <Button variant="danger">{viewCopy.designPreviewText6}</Button>
            </div>
          </Card>
          <Card title={viewCopy.designPreviewText7}>
            <Steps
              steps={[
                viewCopy.tabInspiration,
                viewCopy.tabWriting,
                viewCopy.designPreviewText8,
                viewCopy.finalizeTitle,
              ]}
              current={1}
              label={viewCopy.lifecycle}
            />
            <div className="button-row">
              <StatusBadge mode="fanqie" status="final" />
              <StatusBadge mode="toutiao" status={viewCopy.designPreviewText9} />
            </div>
            <Toggle checked={checked} onChange={setChecked} label={viewCopy.designPreviewText10} />
          </Card>
          <Card>
            <Stat
              label={viewCopy.dashboardText6}
              value="24,800"
              detail={viewCopy.designPreviewText11}
            />
          </Card>
          <div className="lamp-preview-paper">
            <h3>{viewCopy.designPreviewText12}</h3>
            <p>{viewCopy.designPreviewText13}</p>
          </div>
        </section>
      ))}
    </main>
  );
}
