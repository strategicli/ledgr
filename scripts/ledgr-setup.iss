; The Windows installer (install plan step 7): one Ledgr-Setup.exe that puts a
; ready-made package on the computer and ends in the browser on the setup page.
;
; A thin wrapper on purpose. It copies the package, makes the Start menu
; entries, and hands every decision to supervisor/installer.mjs (run with the
; package's own Node): which ports are free, whether another Ledgr is here,
; what to do on an upgrade, what to stop on the way out. See runbook §1t.
;
;   Per user, no Administrator prompt:
;     program  %LOCALAPPDATA%\Programs\Ledgr   (replaced on upgrade, removed on uninstall)
;     data     %LOCALAPPDATA%\LedgrData        (never inside the program folder; kept on
;                                               uninstall unless the owner ticks the box)
;
; Built by .github/workflows/package.yml after scripts/package.mjs:
;   ISCC /DAppVersion=<version> /DChannel=<branch> /DSourceDir=<dist\package\ledgr>
;        /DOutputDir=<dist\package> scripts\ledgr-setup.iss

#ifndef SourceDir
  #error Pass /DSourceDir=<the unpacked package, dist\package\ledgr>
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Channel
  #define Channel "main"
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
; Never change this: it is how an upgrade finds the install it replaces.
#define AppIdGuid "{8C1E2B8A-5F4D-4C7B-9E1A-2D6F0B3A7C51}"
; The installed copy's start-at-sign-in shortcut (supervisor/installer.mjs
; INSTALLED_STARTUP_NAME). Never "Ledgr Supervisor" or a git install's "Ledgr".
#define StartupName "Ledgr app"

[Setup]
AppId={{#AppIdGuid}
AppName=Ledgr
AppVersion={#AppVersion}
AppVerName=Ledgr ({#Channel}, {#AppVersion})
AppPublisher=Ledgr
AppPublisherURL=https://github.com/strategicli/ledgr
DefaultDirName={autopf}\Ledgr
DefaultGroupName=Ledgr
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Ledgr-Setup
SetupIconFile={#SourcePath}..\src\app\favicon.ico
UninstallDisplayIcon={app}\ledgr.ico
UninstallDisplayName=Ledgr
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Our own processes are stopped by installer.mjs; nothing else is ours to close.
CloseApplications=no
RestartApplications=no

[Messages]
WelcomeLabel2=This puts Ledgr on this computer, for this Windows account only (no Administrator prompt).%n%nWhen it finishes, your browser opens on Ledgr's setup page, where you make your sign-in.%n%nIf another copy of Ledgr already runs here, this one is installed beside it and leaves it alone.
FinishedLabel=Ledgr is installed and running. It starts by itself when you sign in to Windows, and its icon sits near the clock.%n%nOpen it any time from the Start menu: Ledgr.

[InstallDelete]
; An upgrade replaces the program folders whole, so no file from an older
; version lingers. Only these names, and only inside the program folder; the
; data folder is elsewhere and is never listed here.
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\drizzle"
Type: filesandordirs; Name: "{app}\node"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\pgtools"
Type: filesandordirs; Name: "{app}\scripts"
Type: filesandordirs; Name: "{app}\supervisor"
Type: filesandordirs; Name: "{app}\tailnet"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#SourcePath}..\src\app\favicon.ico"; DestDir: "{app}"; DestName: "ledgr.ico"; Flags: ignoreversion

[Icons]
Name: "{group}\Ledgr"; Filename: "powershell.exe"; Parameters: "{code:Tray|open}"; WorkingDir: "{app}"; IconFilename: "{app}\ledgr.ico"; Comment: "Open Ledgr in your browser (starts it first if it is not running)"; Flags: runminimized
Name: "{group}\Start Ledgr"; Filename: "powershell.exe"; Parameters: "{code:Tray|boot}"; WorkingDir: "{app}"; IconFilename: "{app}\ledgr.ico"; Comment: "Start Ledgr and its icon near the clock"; Flags: runminimized
Name: "{group}\Stop Ledgr"; Filename: "powershell.exe"; Parameters: "{code:Tray|stop}"; WorkingDir: "{app}"; IconFilename: "{app}\ledgr.ico"; Comment: "Stop Ledgr on this computer until you start it again"; Flags: runminimized
Name: "{group}\Reset Ledgr sign-in password"; Filename: "powershell.exe"; Parameters: "{code:Tray|reset-password}"; WorkingDir: "{app}"; IconFilename: "{app}\ledgr.ico"; Comment: "Set a new sign-in password. Works only at this computer."; Flags: runminimized
Name: "{group}\Uninstall Ledgr"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\node\node.exe"; Parameters: """{app}\supervisor\installer.mjs"" open --data ""{code:DataDir}"" --setup"; Description: "Open Ledgr's setup page in your browser"; Flags: postinstall nowait runhidden skipifsilent; Check: IsFresh
Filename: "{app}\node\node.exe"; Parameters: """{app}\supervisor\installer.mjs"" open --data ""{code:DataDir}"""; Description: "Open Ledgr in your browser"; Flags: postinstall nowait runhidden skipifsilent; Check: IsUpgrade

[UninstallDelete]
; The shortcut the service made (the app's "Start with the computer" box can
; also remove or remake it), and anything left in the program folder.
Type: files; Name: "{userstartup}\{#StartupName}.lnk"
Type: filesandordirs; Name: "{app}"

[Code]
var
  Fresh: Boolean;
  DeleteData: Boolean;

function DataDir(Param: String): String;
begin
  Result := ExpandConstant('{localappdata}\LedgrData');
end;

{ The tray script, which the Start menu entries run: Param '' shows the icon,
  'boot' also starts Ledgr, anything else runs that one ledgr-ctl verb. }
function Tray(Param: String): String;
begin
  Result := '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + ExpandConstant('{app}') +
    '\supervisor\ledgr-tray.ps1" -NodePath "' + ExpandConstant('{app}') + '\node\node.exe" -CtlScript "' +
    ExpandConstant('{app}') + '\supervisor\ledgr-ctl.mjs" -ConfigPath "' + DataDir('') + '\config.json"';
  if Param = 'boot' then
    Result := Result + ' -Boot'
  else if Param <> '' then
    Result := Result + ' -Run ' + Param;
end;

function IsFresh: Boolean;
begin
  Result := Fresh;
end;

function IsUpgrade: Boolean;
begin
  Result := not Fresh;
end;

{ Run supervisor\installer.mjs with the package's Node, hidden, and wait. }
function Helper(Verb, Extra: String): Integer;
var
  Code: Integer;
begin
  if not Exec(ExpandConstant('{app}\node\node.exe'),
    '"' + ExpandConstant('{app}\supervisor\installer.mjs') + '" ' + Verb + ' --app "' + ExpandConstant('{app}') +
    '" --data "' + DataDir('') + '" ' + Extra, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  Result := Code;
end;

{ Never go backwards: an older installer over a newer install would put old
  code in front of a database the newer one already migrated. }
function InitializeSetup(): Boolean;
var
  Installed: String;
begin
  Result := True;
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppIdGuid}_is1',
    'DisplayVersion', Installed) and (CompareStr('{#AppVersion}', Installed) < 0) then
  begin
    SuppressibleMsgBox('A newer Ledgr (' + Installed + ') is already installed, so this older one ({#AppVersion}) will not replace it.' + #13#10#13#10 +
      'Ledgr updates itself from Build > Updates.', mbInformation, MB_OK, IDOK);
    Result := False;
  end;
end;

{ Before any file is copied: note whether this is a fresh install, and stop
  the Ledgr this installer is replacing (never any other one). }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  Fresh := not FileExists(DataDir('') + '\config.json');
  if FileExists(ExpandConstant('{app}\supervisor\installer.mjs')) then
    Exec(ExpandConstant('{app}\node\node.exe'), '"' + ExpandConstant('{app}\supervisor\installer.mjs') +
      '" stop --app "' + ExpandConstant('{app}') + '" --data "' + DataDir('') + '"', ExpandConstant('{app}'),
      SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then
    Exit;
  WizardForm.ProgressGauge.Style := npbstMarquee;
  WizardForm.StatusLabel.Caption := 'Setting up Ledgr...';
  if Helper('prepare', '--channel "{#Channel}"') <> 0 then
  begin
    SuppressibleMsgBox('Ledgr was copied, but setting it up failed. What happened is written in ' + DataDir('') +
      '\install.log.', mbError, MB_OK, IDOK);
    Exit;
  end;
  WizardForm.StatusLabel.Caption := 'Starting Ledgr. The first start takes a minute or two...';
  if Helper('start', '') <> 0 then
    SuppressibleMsgBox('Ledgr is installed but has not finished starting yet. Give it a minute, then open it from the ' +
      'Start menu: Ledgr. If it still does not open, its log is in ' + DataDir('') + '\supervisor.log.',
      mbInformation, MB_OK, IDOK);
end;

{ The uninstaller's one question, as a box that starts unticked. }
function InitializeUninstall(): Boolean;
var
  Form: TSetupForm;
  Msg, Note: TNewStaticText;
  Box: TNewCheckBox;
  OkButton, CancelButton: TNewButton;
begin
  Result := True;
  DeleteData := False;
  if UninstallSilent then
    Exit;
  Form := CreateCustomForm(ScaleX(460), ScaleY(200), False, True);
  try
    Form.Caption := 'Uninstall Ledgr';

    Msg := TNewStaticText.Create(Form);
    Msg.Parent := Form;
    Msg.AutoSize := False;
    Msg.WordWrap := True;
    Msg.Left := ScaleX(16);
    Msg.Top := ScaleY(16);
    Msg.Width := Form.ClientWidth - ScaleX(32);
    Msg.Height := ScaleY(80);
    Msg.Caption := 'This removes the Ledgr program, its Start menu entries and its start-at-sign-in entry.' + #13#10#13#10 +
      'Your notes, tasks and files stay in ' + DataDir('') + ', so installing Ledgr again brings them back.';

    Box := TNewCheckBox.Create(Form);
    Box.Parent := Form;
    Box.Left := ScaleX(16);
    Box.Top := ScaleY(104);
    Box.Width := Form.ClientWidth - ScaleX(32);
    Box.Height := ScaleY(20);
    Box.Caption := 'Also delete all my Ledgr data from this computer';
    Box.Checked := False;

    Note := TNewStaticText.Create(Form);
    Note.Parent := Form;
    Note.AutoSize := False;
    Note.WordWrap := True;
    Note.Left := ScaleX(34);
    Note.Top := Box.Top + ScaleY(22);
    Note.Width := Form.ClientWidth - ScaleX(50);
    Note.Height := ScaleY(34);
    Note.Caption := 'Your notes, tasks, files and backups. This cannot be undone.';

    CancelButton := TNewButton.Create(Form);
    CancelButton.Parent := Form;
    CancelButton.Caption := 'Cancel';
    CancelButton.ModalResult := mrCancel;
    CancelButton.Cancel := True;
    CancelButton.Width := ScaleX(90);
    CancelButton.Height := ScaleY(26);
    CancelButton.Left := Form.ClientWidth - ScaleX(16) - CancelButton.Width;
    CancelButton.Top := Form.ClientHeight - ScaleY(16) - CancelButton.Height;

    OkButton := TNewButton.Create(Form);
    OkButton.Parent := Form;
    OkButton.Caption := 'Uninstall';
    OkButton.ModalResult := mrOk;
    OkButton.Default := True;
    OkButton.Width := ScaleX(90);
    OkButton.Height := ScaleY(26);
    OkButton.Left := CancelButton.Left - ScaleX(8) - OkButton.Width;
    OkButton.Top := CancelButton.Top;

    Result := Form.ShowModal() = mrOk;
    DeleteData := Result and Box.Checked;
  finally
    Form.Free();
  end;
  if DeleteData then
    DeleteData := MsgBox('Delete all your Ledgr data in ' + DataDir('') + '?' + #13#10#13#10 +
      'Your notes, tasks, files and backups on this computer will be gone for good. Choose No to keep them ' +
      'and still uninstall the program.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    { Stop this Ledgr cleanly (and anything of its still running) before its files go. }
    Exec(ExpandConstant('{app}\node\node.exe'), '"' + ExpandConstant('{app}\supervisor\installer.mjs') +
      '" stop --app "' + ExpandConstant('{app}') + '" --data "' + DataDir('') + '"', ExpandConstant('{app}'),
      SW_HIDE, ewWaitUntilTerminated, Code);
    { The scheduled task exists only if the owner chose "start before anyone signs in". }
    Exec('schtasks.exe', '/Delete /TN "{#StartupName}" /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    if DeleteData then
      DelTree(DataDir(''), True, True, True)
    else if not UninstallSilent then
      MsgBox('Ledgr is removed. Your data is still in ' + DataDir('') + '. Install Ledgr again to use it, ' +
        'or delete that folder yourself if you no longer want it.', mbInformation, MB_OK);
  end;
end;
