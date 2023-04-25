import { Colors } from "@/libs/colors/colors";
import { Emojis } from "@/libs/emojis/emojis";
import { Outline } from "@/libs/icons/icons";
import { Dialog, DialogTitle } from "@/libs/modals/dialog";
import { useModhash } from "@/libs/modhash/modhash";
import { useAsyncUniqueCallback } from "@/libs/react/callback";
import { useInputChange } from "@/libs/react/events";
import { CloseProps } from "@/libs/react/props/close";
import { Mutator } from "@/libs/xswr/pipes";
import { GradientButton } from "@/mods/components/buttons/button";
import { Bytes } from "@hazae41/bytes";
import { useMemo, useState } from "react";
import { UserData } from "../data";
import { Password } from "../password";
import { useUsers } from "./data";
import { UserAvatar } from "./page";

export function UserCreateDialog(props: CloseProps) {
  const { close } = props

  const users = useUsers()

  const uuid = useMemo(() => {
    return crypto.randomUUID()
  }, [])

  const modhash = useModhash(uuid)
  const color = Colors.mod(modhash)
  const emoji = Emojis.get(modhash)

  const [name = "", setName] = useState<string>()

  const onNameChange = useInputChange(e => {
    setName(e.currentTarget.value)
  }, [])

  const [password = "", setPassword] = useState<string>()

  const onPasswordChange = useInputChange(e => {
    setPassword(e.currentTarget.value)
  }, [])

  const [password2 = "", setPassword2] = useState<string>()

  const onPassword2Change = useInputChange(e => {
    setPassword2(e.currentTarget.value)
  }, [])

  const isSamePassword = useMemo(() => {
    return password === password2
  }, [password, password2])

  const onClick = useAsyncUniqueCallback(async () => {
    const keySalt = Bytes.toBase64(Bytes.random(16))
    const valueSalt = Bytes.toBase64(Bytes.random(16))

    const passwordSaltBytes = Bytes.random(16)
    const passwordHashBytes = await Password.hash(password, passwordSaltBytes)

    const passwordSalt = Bytes.toBase64(passwordSaltBytes)
    const passwordHash = Bytes.toBase64(passwordHashBytes)

    const user: UserData = { uuid, name, color, emoji, keySalt, valueSalt, passwordSalt, passwordHash }

    users.mutate(Mutator.data((d = []) => [...d, user]))

    close()
  }, [uuid, name, color, emoji, password])

  const NameInput =
    <div className="flex items-center gap-2">
      <div className="shrink-0">
        <UserAvatar className="icon-5xl text-2xl"
          colorIndex={color}
          name={name} />
      </div>
      <input className="p-xmd w-full rounded-xl outline-none bg-transparent border border-contrast focus:border-opposite"
        placeholder="Name"
        value={name} onChange={onNameChange} />
    </div>

  const PasswordInput =
    <input className="p-xmd w-full rounded-xl outline-none bg-transparent border border-contrast focus:border-opposite"
      type="password"
      placeholder="Password"
      value={password} onChange={onPasswordChange} />

  const PasswordInput2 =
    <input className="p-xmd w-full rounded-xl outline-none bg-transparent border border-contrast focus:border-opposite"
      type="password"
      placeholder="Confirm password"
      value={password2} onChange={onPassword2Change} />

  const DoneButton =
    <GradientButton className="w-full"
      colorIndex={color}
      disabled={!name || !password || !password2 || !isSamePassword}
      icon={Outline.PlusIcon}
      onClick={onClick.run}>
      Add
    </GradientButton>

  return <Dialog close={close}>
    <DialogTitle close={close}>
      New user
    </DialogTitle>
    <div className="h-2" />
    {NameInput}
    <div className="h-2" />
    {PasswordInput}
    <div className="h-2" />
    {PasswordInput2}
    <div className="h-4" />
    {DoneButton}
  </Dialog>
}