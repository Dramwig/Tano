; Per-user, opt-in Explorer verbs. Do not replace the default Markdown app.
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

Var TanoShellLoaded
Var TanoFolderMenu
Var TanoMarkdownMenu
Var TanoFolderCheckbox
Var TanoMarkdownCheckbox
Var TanoOptionsDialog

!define TANO_SHELL_PREFS "Software\app.tano.local\ShellIntegration"
!define TANO_FOLDER_VERB "Software\Classes\Directory\shell\Tano.Open"
!define TANO_BACKGROUND_VERB "Software\Classes\Directory\Background\shell\Tano.Open"
!define TANO_MD_VERB "Software\Classes\SystemFileAssociations\.md\shell\Tano.Open"
!define TANO_MARKDOWN_VERB "Software\Classes\SystemFileAssociations\.markdown\shell\Tano.Open"

; Hooks are included before Tauri's built-in pages, so show this optional
; integration page first. .onInit has already selected the installer language.
Page custom TanoShellPage TanoShellPageLeave

Function TanoLoadShellOptions
  ${If} $TanoShellLoaded != 1
    StrCpy $TanoFolderMenu 0
    StrCpy $TanoMarkdownMenu 0
    ReadRegDWORD $TanoFolderMenu HKCU "${TANO_SHELL_PREFS}" "Folders"
    ReadRegDWORD $TanoMarkdownMenu HKCU "${TANO_SHELL_PREFS}" "Markdown"
    ; Explicit flags also work in silent installers. Omission keeps prior choices.
    ${GetParameters} $R8
    ClearErrors
    ${GetOptions} $R8 "/TANOFOLDERS=" $R9
    ${IfNot} ${Errors}
      ${If} $R9 == 1
        StrCpy $TanoFolderMenu 1
      ${ElseIf} $R9 == 0
        StrCpy $TanoFolderMenu 0
      ${EndIf}
    ${EndIf}
    ClearErrors
    ${GetOptions} $R8 "/TANOMARKDOWN=" $R9
    ${IfNot} ${Errors}
      ${If} $R9 == 1
        StrCpy $TanoMarkdownMenu 1
      ${ElseIf} $R9 == 0
        StrCpy $TanoMarkdownMenu 0
      ${EndIf}
    ${EndIf}
    StrCpy $TanoShellLoaded 1
  ${EndIf}
FunctionEnd

Function TanoShellPage
  Call TanoLoadShellOptions
  ${GetParameters} $R8
  ClearErrors
  ${GetOptions} $R8 "/P" $R9
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  ClearErrors
  ${GetOptions} $R8 "/UPDATE" $R9
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  IfSilent 0 +2
    Abort
  ${If} $LANGUAGE == 2052
    !insertmacro MUI_HEADER_TEXT "资源管理器右键菜单" "选择通过 Tano 打开文件夹和 Markdown 文件的方式。"
  ${Else}
    !insertmacro MUI_HEADER_TEXT "File Explorer context menus" "Choose how to open folders and Markdown files with Tano."
  ${EndIf}
  nsDialogs::Create 1018
  Pop $TanoOptionsDialog
  ${If} $TanoOptionsDialog == error
    Abort
  ${EndIf}
  ${If} $LANGUAGE == 2052
    ${NSD_CreateLabel} 0 0 100% 36u "选择是否将 Tano 加入资源管理器右键菜单。$\r$\nWindows 11 中位于“显示更多选项”，不改变默认打开程序。"
    Pop $0
    ${NSD_CreateCheckbox} 0 48u 100% 24u "文件夹：通过 Tano 打开（作为工作区）"
    Pop $TanoFolderCheckbox
    ${NSD_CreateCheckbox} 0 82u 100% 24u "Markdown 文件：通过 Tano 打开（独立文件）"
    Pop $TanoMarkdownCheckbox
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 36u "Add Tano to File Explorer context menus.$\r$\nOn Windows 11, use Show more options. Default apps stay unchanged."
    Pop $0
    ${NSD_CreateCheckbox} 0 48u 100% 24u "Folders: Open with Tano (as workspace)"
    Pop $TanoFolderCheckbox
    ${NSD_CreateCheckbox} 0 82u 100% 24u "Markdown files: Open with Tano (standalone file)"
    Pop $TanoMarkdownCheckbox
  ${EndIf}
  ${NSD_SetState} $TanoFolderCheckbox $TanoFolderMenu
  ${NSD_SetState} $TanoMarkdownCheckbox $TanoMarkdownMenu
  nsDialogs::Show
FunctionEnd

Function TanoShellPageLeave
  ${NSD_GetState} $TanoFolderCheckbox $TanoFolderMenu
  ${NSD_GetState} $TanoMarkdownCheckbox $TanoMarkdownMenu
FunctionEnd

!macro TanoWriteVerb KEY FLAG ARG
  ${If} $LANGUAGE == 2052
    WriteRegStr HKCU "${KEY}" "" "通过 Tano 打开"
  ${Else}
    WriteRegStr HKCU "${KEY}" "" "Open with Tano"
  ${EndIf}
  WriteRegStr HKCU "${KEY}" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "${KEY}" "MultiSelectModel" "Single"
  WriteRegStr HKCU "${KEY}\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" ${FLAG} $\"${ARG}$\"'
!macroend

!macro NSIS_HOOK_PREINSTALL
  Call TanoLoadShellOptions
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegDWORD HKCU "${TANO_SHELL_PREFS}" "Folders" $TanoFolderMenu
  WriteRegDWORD HKCU "${TANO_SHELL_PREFS}" "Markdown" $TanoMarkdownMenu
  ${If} $TanoFolderMenu == 1
    ; A final "\." keeps drive roots from ending a quoted argv with a backslash.
    !insertmacro TanoWriteVerb "${TANO_FOLDER_VERB}" "--open-folder" "%1\."
    !insertmacro TanoWriteVerb "${TANO_BACKGROUND_VERB}" "--open-folder" "%V\."
  ${Else}
    DeleteRegKey HKCU "${TANO_FOLDER_VERB}"
    DeleteRegKey HKCU "${TANO_BACKGROUND_VERB}"
  ${EndIf}
  ${If} $TanoMarkdownMenu == 1
    !insertmacro TanoWriteVerb "${TANO_MD_VERB}" "--open-file" "%1"
    !insertmacro TanoWriteVerb "${TANO_MARKDOWN_VERB}" "--open-file" "%1"
  ${Else}
    DeleteRegKey HKCU "${TANO_MD_VERB}"
    DeleteRegKey HKCU "${TANO_MARKDOWN_VERB}"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "${TANO_FOLDER_VERB}"
  DeleteRegKey HKCU "${TANO_BACKGROUND_VERB}"
  DeleteRegKey HKCU "${TANO_MD_VERB}"
  DeleteRegKey HKCU "${TANO_MARKDOWN_VERB}"
  ${If} $UpdateMode != 1
    DeleteRegKey HKCU "${TANO_SHELL_PREFS}"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
